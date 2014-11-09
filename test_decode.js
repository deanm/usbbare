var structs = require('./structs.js');
var decoder = require('./packet_decoder.js');

function field_get_value(fields, name) {
  for (var i = 0, il = fields.length; i < il; i += 3) {
    if (fields[i] === name) return fields[i+1];
  }
  return null;
}

function field_get_value_str(fields, name) {
  for (var i = 0, il = fields.length; i < il; i += 3) {
    if (fields[i] === name) return fields[i+2];
  }
  return null;
}

function field_get_display(fields, name) {
  for (var i = 0, il = fields.length; i < il; i += 3) {
    if (fields[i] === name) {
      var display = "0x" + fields[i+1].toString(16);
      if (fields[i+2] !== null)
        display += " (" + fields[i+2] + ")";
      return display;
    }
  }
  return undefined;
  return null;
}

function fields_display(fields, prefix) {
  var ftext = "";
  for (var i = 0, il = fields.length; i < il; i += 3) {
    if (i !== 0) ftext += "\n";
    ftext += prefix + fields[i] + ': 0x' + fields[i+1].toString(16);
    if (fields[i+2] !== null) ftext += ' (' + fields[i+2] + ')';
  }
  return ftext;
}


function state_wait_for_ack_next(revert, next, cb) {
  return function(pp) {
    if (pp.pid_type !== 2 || pp.pid_name !== 0) return revert;
    if (cb !== undefined && cb !== null) cb(pp);
    return next;
  };
}

function state_expect_ack_next(next, cb) {
  return function(pp) {
    if (pp.pid_type !== 2 || pp.pid_name !== 0) throw JSON.stringify(pp);
    if (cb !== undefined && cb !== null) cb(pp);
    return next;
  };
}

function state_expect_ack(pp) {
  if (pp.pid_type !== 2 || pp.pid_name !== 0) throw JSON.stringify(pp);
  return state_initial;
}

// - Control Transfers
//   - Setup stage (setup, data0, ~ack)
//   - Data stage (amount determined by setup stage)
//     either: IN:  (in, ~data, ack)
//             OUT: (out, data, ~ack/nak/stall)
//     - can stall (error) or NAK (not ready)
//   - Status stage
//     IN:  out, 0 len data0, ~ack
//     OUT:  in, ~0 len data0, ack

// Expect setup token -> data0 -> ack
function state_ct_setup1(addr, endp, emit) {  // Expecting data0 packet
  return function(pp, rp) {
    if (pp.pid_type !== 3 || pp.pid_name !== 0) throw JSON.stringify(pp);
    if (rp.length !== 11) throw JSON.stringify(pp);  // Should be 8 byte data packet.
    var fields = [ ];
    structs.parse_setup(fields, rp, 1, rp.length);
    //console.log(fields_display(fields, "  "));
    var num_bytes = field_get_value(fields, "wLength");  // fields[19];
    var device_to_host = field_get_value(fields, "bmRequestType.transferDirection");  // fields[7];
    if (num_bytes === 0) {  // No data stage.
      var next_state = device_to_host ? state_ct_status0_in : state_ct_status0_out;
      return state_expect_ack_next(next_state(addr, endp, fields, [ ], emit));
    }

    var next_state = device_to_host ? state_ct_data0_in : state_ct_data0_out;
    return state_expect_ack_next(next_state(addr, endp, fields, [ ], num_bytes, emit));
  };
}

function state_ct_data0_in(addr, endp, setup, data, num_bytes, emit) {
  var self = function(pp) {
    // Looking for a token IN, if not stay in state.
    if (pp.pid_type !== 1 || pp.pid_name !== 2) return null;
    if (pp.ADDR !== addr || pp.EndPoint !== endp) return null;
    return state_ct_data1_in(addr, endp, setup, data, num_bytes, self, emit);
  };
  return self;
}

function state_ct_data0_out(addr, endp, setup, data, num_bytes, emit) {
  var self = function(pp) {
    // Looking for a token OUT, if not stay in state.
    if (pp.pid_type !== 1 || pp.pid_name !== 0) return null;
    if (pp.ADDR !== addr || pp.EndPoint !== endp) return null;
    return state_ct_data1_out(addr, endp, setup, data, num_bytes, self, emit);
  };
  return self;
}

function state_ct_data1_in(addr, endp, setup, data, num_bytes, revert_state, emit) {
  return function(pp, rp) {
    if (pp.pid_type === 2) {  // Handshake
      if (pp.pid_name === 2) return revert_state;  // NAK, go back to state, try again.
      throw "xx, stall?";
    }

    if (pp.pid_type === 3) {  // Data
      var dlen = rp.length - 3;
      if (dlen > num_bytes) throw "xx";
      console.log(rp);
      data = data.concat(rp.slice(1, rp.length - 2));
      num_bytes -= dlen;
      if (num_bytes > 0)
        return state_expect_act_next(state_ct_data0_in(addr, endp, setup, data, num_bytes, emit));
      return state_expect_ack_next(state_ct_status0_in(addr, endp, setup, data, emit));
    }

    throw JSON.stringify(pp);
  };
}

// IN status stage: H out -> H 0 len data0 -> D ack/stall/nak
function state_ct_status0_in(addr, endp, setup, data, emit) {  // H out
  return function(pp) {
    // Looking for a token OUT, if not stay in state.
    if (pp.pid_type !== 1 || pp.pid_name !== 0) return null;
    if (pp.ADDR !== addr || pp.EndPoint !== endp) return null;
    return state_ct_status1_in(addr, endp, setup, data, emit);
  };
}

// OUT status stage: H IN -> H 0 len data0 -> D ack/stall/nak
function state_ct_status0_out(addr, endp, setup, data, emit) {  // H out
  var self = function(pp) {
    // Looking for a token IN, if not stay in state.
    if (pp.pid_type !== 1 || pp.pid_name !== 2) return null;
    if (pp.ADDR !== addr || pp.EndPoint !== endp) return null;
    return state_ct_status1_out(self, addr, endp, setup, data, emit);
  };
  return self;
}

function state_ct_status1_in(addr, endp, setup, data, emit) {  // H 0 len data0
  return function(pp) {  // Expect a zero length data.
    // FIXME: Is it supposed to be just DATA0, or also DATA1 ?
    if (pp.pid_type !== 3 || (pp.pid_name !== 0 && pp.pid_name !== 2)) throw JSON.stringify(pp);
    if (pp.data_len !== 0) throw JSON.stringify(pp);
    return state_expect_ack_next(state_initial, function(pp) {
      emit(addr, endp, setup, data);
    });
  };
}

function state_ct_status1_out(revert, addr, endp, setup, data, emit) {  // H 0 len data0
  return function(pp) {  // Expect a zero length data.
    if (pp.pid_type === 2 && pp.pid_name === 2) return revert;  // NAK
    // FIXME: Is it supposed to be just DATA0, or also DATA1 ?
    if (pp.pid_type !== 3 || (pp.pid_name !== 0 && pp.pid_name !== 2)) throw JSON.stringify(pp);
    if (pp.data_len !== 0) throw JSON.stringify(pp);
    return state_expect_ack_next(state_initial, function(pp) {
      emit(addr, endp, setup, data);
    });
  };
}

function emit_ct(addr, endp, setup, data) {
  console.log("Control transfer: addr: " + addr + " endpoint: " + endp);
  var bRequest = field_get_value(setup, "bRequest");
  console.log(fields_display(setup, "  "));

  switch (bRequest) {
    case 6: // GET_DESCRIPTOR
      var wvalue = field_get_value(setup, "wValue");
      var desctype = wvalue >> 8, descidx = wvalue & 0xff;
      console.log(desctype);
      console.log(structs.eDescriptorTypes[desctype]);
      console.log(data);
      break;
    default:
      console.log("Unknown bRequest: " + bRequest);
      break;
  }
}

function state_initial(pp) {
  if (pp.pid_type === 1 && pp.pid_name === 3) {
    return state_ct_setup1(pp.ADDR, pp.EndPoint, emit_ct);
  }

  return state_initial;
}

var cur_state = state_initial;

function process_packet(rp) {

  var fields = [ ];

  // rp: raw packet, pp: parsed packet
  var pp = decoder.decode_packet(rp);

  if (pp.error !== null) throw pp.error;

  if (pp.pid_type === 1 && pp.pid_name === 1) return;  // Ignore SOF

  var next_state = cur_state(pp, rp);
  if (next_state !== null) {
    //console.log(pp);
    cur_state = next_state;
  }
}

function forAsyncEachLine(stream, line_callback, eof_callback) {
  var leftovers = '';

  stream.on('data', function(data) {
    var prev = 0;
    for (var i = 0, il = data.length; i < il; ++i) {
      if (data[i] === '\n') {
        if (i === prev && leftovers.length === 0) {
          ++prev;
        } else {
          line_callback(leftovers + data.substr(prev, i-prev));
          leftovers = '';
          prev = i + 1;
        }
      }
    }
    if (prev !== i) leftovers = data.substr(prev, i-prev);
  });

  stream.on('close', function() {
    if (leftovers.length !== 0) {
      // console.log('No trailing newline...');
      line_callback(leftovers);
    }
    eof_callback();
  });
}

function process_file(filename) {
  var fs = require('fs');
  var f = fs.createReadStream(filename, {encoding: 'utf8'});
  forAsyncEachLine(f, function(line) {
    var ind = line.indexOf('data=');
    var packet = [ ];
    for (i = ind + 5, il = line.length; i < il; i += 3) {
      packet.push(parseInt(line.substr(i, 3), 16));
    }
    if (packet.length !== 0) process_packet(packet);
  }, function() { });
}

if (process.argv.length > 2) {
  process_file(process.argv[2]);
} else {
  console.log("usage: <filename>");
}
