var structs = require('./structs.js');
var decoder = require('./packet_decoder.js');
var states = require('./transfer_states.js');

var kStateDone = { };
var kStateSame = { };

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
  return kStateDone;
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
    var fields = new structs.Fields();
    structs.parse_setup(fields, rp, 1, rp.length);
    //console.log(fields_display(fields, "  "));
    var num_bytes = fields.get_value("wLength");  // fields[19];
    var device_to_host = fields.get_value("bmRequestType.transferDirection");  // fields[7];
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
    if (pp.pid_type !== 1 || pp.pid_name !== 2) return kStateSame;
    if (pp.ADDR !== addr || pp.EndPoint !== endp) return kStateSame;
    return state_ct_data1_in(addr, endp, setup, data, num_bytes, self, emit);
  };
  return self;
}

function state_ct_data0_out(addr, endp, setup, data, num_bytes, emit) {
  var self = function(pp) {
    // Looking for a token OUT, if not stay in state.
    if (pp.pid_type !== 1 || pp.pid_name !== 0) return kStateSame;
    if (pp.ADDR !== addr || pp.EndPoint !== endp) return kStateSame;
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
    if (pp.pid_type !== 1 || pp.pid_name !== 0) return kStateSame;
    if (pp.ADDR !== addr || pp.EndPoint !== endp) return kStateSame;
    return state_ct_status1_in(addr, endp, setup, data, emit);
  };
}

// OUT status stage: H IN -> H 0 len data0 -> D ack/stall/nak
function state_ct_status0_out(addr, endp, setup, data, emit) {  // H out
  var self = function(pp) {
    // Looking for a token IN, if not stay in state.
    if (pp.pid_type !== 1 || pp.pid_name !== 2) return kStateSame;
    if (pp.ADDR !== addr || pp.EndPoint !== endp) return kStateSame;
    return state_ct_status1_out(self, addr, endp, setup, data, emit);
  };
  return self;
}

function state_ct_status1_in(addr, endp, setup, data, emit) {  // H 0 len data0
  return function(pp) {  // Expect a zero length data.
    // FIXME: Is it supposed to be just DATA0, or also DATA1 ?
    if (pp.pid_type !== 3 || (pp.pid_name !== 0 && pp.pid_name !== 2)) throw JSON.stringify(pp);
    if (pp.data.length !== 0) throw JSON.stringify(pp);
    return state_expect_ack_next(kStateDone, function(pp) {
      emit(addr, endp, setup, data);
    });
  };
}

function state_ct_status1_out(revert, addr, endp, setup, data, emit) {  // H 0 len data0
  return function(pp) {  // Expect a zero length data.
    if (pp.pid_type === 2 && pp.pid_name === 2) return revert;  // NAK
    // FIXME: Is it supposed to be just DATA0, or also DATA1 ?
    if (pp.pid_type !== 3 || (pp.pid_name !== 0 && pp.pid_name !== 2)) throw JSON.stringify(pp);
    if (pp.data.length !== 0) throw JSON.stringify(pp);
    return state_expect_ack_next(kStateDone, function(pp) {
      emit(addr, endp, setup, data);
    });
  };
}


function TransferMachine() {
  var this_ = this;

  function emit_ct(tid, addr, endp, setup, data) {
    if (this_.OnControlTransfer === null) return;
    this_.OnControlTransfer(tid, addr, endp, setup, data);
  }

  function state_initial(pp) {
    if (pp.pid_type === 1 && pp.pid_name === 3) {
      return state_ct_setup1(pp.ADDR, pp.EndPoint, emit_ct);
    }

    return state_initial;
  }

  var cur_state = states.state_start();

  var transaction_id = 0;

  this.process_packet = function(rp) {
    // rp: raw packet, pp: parsed packet
    var pp = decoder.decode_packet(rp);

    if (pp.error !== null) throw pp.error;

    if (pp.pid_type === 1 && pp.pid_name === 1) return null;  // Ignore SOF

    //console.log(pp);
    var res = cur_state(rp, pp);
    //console.log(res);

    if (res.emit !== null && res.emit[0] === "ControlTransfer") {
      emit_ct(transaction_id, res.emit[1], res.emit[2], res.emit[3], res.emit[4]);
    }

    if (res.next === states.kDone) {
      transaction_id++;
      cur_state = states.state_start();
      return transaction_id-1;
    } else if (res.next === states.kPass) {
      return null;
    }

    cur_state = res.next;
    return transaction_id;
  };

  this.OnControlTransfer = null;
}

try {
  exports.TransferMachine = TransferMachine;
} catch(e) { }
