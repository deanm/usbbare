var decoder = require('./packet_decoder.js');
var usb_machines = require('./usb_machines.js');
var structs = require('./structs.js');

function ce(name, styles) {
  var e = document.createElement(name);
  if (!styles) return e;
  for (key in styles) e.style[key] = styles[key];
  return e;
}

function text_span(str, opts) {
  var e = ce('span', opts);
  e.appendChild(document.createTextNode(str));
  return e;
}

function text_div(str, bp, lp) {
  var div = document.createElement('div');
  div.innerText = str;
  if (lp !== null)
    div.style.paddingLeft = lp + 'px';
  if (bp !== null)
    div.style.paddingBottom = bp + 'px';
  return div;
}

function to_bin_str(len, v) {
  var str = '';
  for (var i = 0; i < len; ++i) {
    str = (v & 1) + str;
    v >>= 1;
  }
  return str;
}

function make_bit_field_node(name, val, str) {
  var span = document.createElement('span');
  span.className = "usbbare-bitfield";
  span.innerText = str;
  span.title = name + ': ' + val;
  span.style.paddingLeft = "0.3em";
  return span;
}


function make_field(name, numbits, fields) {

  var div = document.createElement('div');
  var title = document.createElement('div');
  var body = document.createElement('div');

  div.style.display = 'inline-block';
  div.style.width = numbits + 'em';
  div.style.textAlign = 'center';
  div.style.marginRight = '0.6em';
  title.innerText = name;
  title.style.borderBottom = "1px solid #eee";

  for (var i = 0, il = fields.length; i < il; ++i)
    body.appendChild(fields[i]);

  div.appendChild(title); div.appendChild(body);

  return div;
}

var kPidNameTable =  [
  "RESERVED", "PING", "SPLIT", "PRE/ERR",
  "OUT", "SOF", "IN", "SETUP",
  "ACK", "NYET", "NAK", "STALL",
  "DATA0", "DATA2", "DATA1", "MDATA"
];

function hex_dump(data, cols) {
  var str = '';
  var lp = 0;
  for (var i = 0, il = data.length; i < il; ++i) {
    var hex = data[i].toString(16);
    if (lp >= cols) {
      str += "\n";
      lp = 0;
    }
    if (hex.length < 2) hex = "0" + hex;
    if (lp !== 0) str += ' ';
    str += hex;
    ++lp;
  }
  return str;
}

function flatten(arr, out) {
  for (var i = 0, il = arr.length; i < il; ++i) {
    var a = arr[i];
    if (Array.isArray(a)) flatten(a, out);
    else out.push(a);
  }
}

function build_table_from_fields(f) {
  var table = document.createElement('table');
  var n = f.num_fields();
  for (var i = 0; i < n; ++i) {
    var tr = document.createElement('tr');
    var name = f.get_name_at(i) + ":" + f.get_size_at(i);
    var td0 = document.createElement('td');
    td0.appendChild(document.createTextNode(name));
    var td1 = document.createElement('td');
    td1.appendChild(document.createTextNode(f.get_value_at(i)));
    td1.style.textAlign = 'right';
    var display = f.get_display_at(i);
    var td2 = document.createElement('td');
    if (display !== null)
      td2.appendChild(document.createTextNode("(" + display + ")"));
    tr.appendChild(td0);
    tr.appendChild(td1);
    tr.appendChild(td2);
    table.appendChild(tr);
  }
  table.style.marginLeft = "1em";
  return table;
}

function disect_config_desc(n, flat_data) {
  var descriptor = new structs.Fields();
  if (structs.parse_StandardConfigurationDescriptor(
      descriptor, flat_data, 0, flat_data.length) === false) {
    n.appendChild(text_div("failed to parse config descriptor", 6, 15));
    return;
  }

  n.appendChild(text_div("CONFIGURATION", 2));
  n.appendChild(build_table_from_fields(descriptor));

  var num_interfaces = descriptor.get_value("bNumInterfaces");
  var tlen = descriptor.get_value("wTotalLength");
  var pos = 0;
  tlen -= descriptor.get_value("bLength");
  pos += descriptor.get_value("bLength");

  for (var i = 0; i < num_interfaces; ++i) {
    var iface = new structs.Fields();
    if (structs.parse_StandardInterfaceDescriptor(
        iface, flat_data, pos, flat_data.length) === false) {
      n.appendChild(text_div("failed to parse interface descriptor", 6, 15));
      return;
    }
    n.appendChild(text_div("INTERFACE", 2));
    n.appendChild(build_table_from_fields(iface));
    pos += iface.get_value("bLength");

    var num_eps = iface.get_value("bNumEndpoints");
    for (var j = 0; j < num_eps; ++j) {
      var ep = new structs.Fields();
      if (structs.parse_StandardEndpointDescriptor(
          ep, flat_data, pos, flat_data.length) === false) {
        n.appendChild(text_div("failed to parse endpoint descriptor", 6, 15));
        return;
      }
      n.appendChild(text_div("ENDPOINT", 2));
      n.appendChild(build_table_from_fields(ep));
      pos += ep.get_value("bLength");
    }
  }
}

function build_transfer_display(n, trans, id) {
  while (n.firstChild) n.removeChild(n.firstChild);

  n.appendChild(text_div("Transaction: " + id, 5));

  var addr = trans[0], endp = trans[1], setup = trans[2], data = trans[3];

  n.appendChild(text_div("Control transfer: addr: " + addr + " endpoint: " + endp, 2));
  n.appendChild(build_table_from_fields(setup));

  var flat_data = [ ];
  if (data !== null) flatten(data, flat_data);

  var bRequest = setup.get_value("bRequest");
  switch (bRequest) {
    case 6: // GET_DESCRIPTOR
      var wvalue = setup.get_value("wValue");
      var desctype = wvalue >> 8, descidx = wvalue & 0xff;

      switch (desctype) {
        case 2:  // config
          disect_config_desc(n, flat_data);
          break;
        default:
          n.appendChild(text_div(structs.eDescriptorTypes[desctype], 2));
          break;
      }
      break;

    default:
      console.log("Unknown bRequest: " + bRequest);
      break;
  }

  if (flat_data.length > 0) {
    n.appendChild(text_div('Data:'), 2);
    n.appendChild(text_div(hex_dump(flat_data, 8), 0, 15));
  }
}

function build_transaction_display(n, tr) {
  while (n.firstChild) n.removeChild(n.firstChild);

  n.appendChild(text_div('Type: ' + tr.typename));
  n.appendChild(text_div('Success: ' + tr.success));
  n.appendChild(text_div('Packet IDs: ' + tr.ids));
  var out = tr.out;
  for (key in out) {
    if (key.substr(key.length - 2) === "_m") continue;
    if (key === "setup" && typeof out[key] === "object") {
      n.appendChild(build_table_from_fields(out.setup));
      continue;
    }
    if (key === "data" && Array.isArray(out[key])) {
      var flat_data = [ ];
      flatten(out[key], flat_data);
      n.appendChild(text_div(hex_dump(flat_data, 16)));
      continue
    }
    n.appendChild(text_div(key + ': ' + out[key]));
  }

  //n.appendChild(text_span(JSON.stringify(tr)));
}

function build_packet_display(n, p) {
  while (n.firstChild) n.removeChild(n.firstChild);

  var d = decoder.decode_packet(p.d);
  if (d.error !== null) {
    n.innerText = 'ERROR: ' + d.error;
    return;
  }

  //n.appendChild(text_div(JSON.stringify(d)));
  var pid_type_str = ["special", "token", "handshake", "data"][d.pid_type];
  var pid_name_str = kPidNameTable[d.pid_type << 2 | d.pid_name];

  n.appendChild(make_field("PID", 4,
    [make_bit_field_node("pid_type", d.pid_type + " (" + pid_type_str + ")", to_bin_str(2, d.pid_type)),
     make_bit_field_node("pid_name", d.pid_name + " (" + pid_name_str + ")", to_bin_str(2, d.pid_name))]));

  if (d.pid_type === 1 || (d.pid_type === 0 && d.pid_name === 1)) {  // Token
    if (d.pid_type === 1 && d.pid_name === 1) {  // SOF
      n.appendChild(make_field("FrameNumber", 11,
        [make_bit_field_node("FrameNumber", d.FrameNumber, to_bin_str(11, d.FrameNumber))]));
    } else {
      n.appendChild(make_field("ADDR", 6,
        [make_bit_field_node("ADDR", d.ADDR, to_bin_str(7, d.ADDR))]));
      n.appendChild(make_field("EndPoint", 5,
        [make_bit_field_node("EndPoint", d.EndPoint, to_bin_str(4, d.EndPoint))]));
    }
    n.appendChild(make_field("CRC5", 5,
      [make_bit_field_node("CRC5", d.CRC5, to_bin_str(5, d.CRC5))]));
  } else if (d.pid_type === 3) {  // Data
    n.appendChild(make_field("DATA", 4,
      [make_bit_field_node("data length", d.data.length, "...")]));
    n.appendChild(make_field("CRC16", 11,
      [make_bit_field_node("CRC16", d.CRC16, to_bin_str(16, d.CRC16))]));
  }
}

function build_packet_line(p, num, height) {
  var line = document.createElement('div');
  line.style.height = height;
  var n = document.createElement('span');
  var ts = document.createElement('span');
  var f = document.createElement('span');
  var trans = document.createElement('span');
  var desc = document.createElement('span');
  n.innerText = num; ts.innerText = p.t;
  f.innerText = p.f;
  if (p.transaction_id === undefined) {
    trans.innerText = '-';
  } else {
    trans.innerText = p.transaction_id >> 1;
    trans.style.color = (p.transaction_id & 1) ? "#090" : "#900";
  }
  desc.innerText = decoder.decode_packet_to_display_string(p.d);
  line.appendChild(n); line.appendChild(ts);
  line.appendChild(f); line.appendChild(trans);
  line.appendChild(desc);
  return line;
}

function build_transaction_line(tr, num, height) {
  var line = document.createElement('div');
  line.style.height = height;
  var n = document.createElement('span');
  var ts = document.createElement('span');
  var trans = document.createElement('span');
  var desc = document.createElement('span');
  n.style.color = (tr.success === true) ? "#090" : "#900";
  n.innerText = num; ts.innerText = tr.t;
  //f.innerText = '';
  desc.innerText = tr.typename;
  line.appendChild(n); line.appendChild(ts);
  line.appendChild(trans);
  line.appendChild(desc);
  return line;
}

function LazyTable(cell_height, cells) {
  var this_ = this;

  var num_cells = cells.length;

  var total_height = num_cells * cell_height;

  var div = ce('div');

  var hole0 = ce('div', {backgroundColor: 'blue', height: 0})
  var hole1 = ce('div', {backgroundColor: 'red',  height: total_height + 'px'})

  var a = 0;
  var b = 0;

  var expanded_id = null;
  var expanded_node = null;

  this.should_display_as_selected = function(a) {
    /*
    if (cur_transaction_id === null) return false;
    return cells[a].transaction_id === cur_transaction_id;
    */
    return false;
  }

  this.build_cell = function(id) {
    return null;
  };

  this.remove_cell = function(n) {
    div.removeChild(n);
  };

  this.remove_expanded = function(n) {
    div.removeChild(n);
  };

  this.build_expanded = function(id) {
    return null;
  };

  function empty_layout() {  // Collapse b to a, emptying all cells.
    while (b > a) {
      --b;
      if (b === expanded_id) this_.remove_expanded(hole1.previousSibling);
      this_.remove_cell(hole1.previousSibling);
    }
  }

  var body = document.body;

  function layout() {
    var stop = body.scrollTop - div.offsetTop;

    var c = stop / cell_height | 0;
    var d = (stop + body.clientHeight + cell_height) / cell_height | 0;
    c -= 10; d += 10;  // Some buffer
    if (c < 0) c = 0;
    if (d > num_cells) d = num_cells;
    if (d < c) d = c;

    while (a < c && a < b) {  // removing elements from the top
      this_.remove_cell(hole0.nextSibling);
      if (a === expanded_id) this_.remove_expanded(hole0.nextSibling);
      ++a;
    }

    while (b > d && b > a) {  // removing elements from the bottom
      --b;
      if (b === expanded_id) this_.remove_expanded(hole1.previousSibling);
      this_.remove_cell(hole1.previousSibling);
    }

    if (a === b) a = b = c;

    while (a > c) {  // adding elements to the top
      a--;
      if (a === expanded_id) div.insertBefore(expanded_node, hole0.nextSibling);
      var cell = this_.build_cell(a);
      cell.cell_id = a;
      div.insertBefore(cell, hole0.nextSibling);
    }

    while (b < d && b < num_cells) {  // adding elements to the bottom
      var cell = this_.build_cell(b);
      cell.cell_id = b;
      div.insertBefore(cell, hole1);
      if (b === expanded_id) div.insertBefore(expanded_node, hole1);
      ++b;
    }

    var hole0_height = a * cell_height;
    var hole1_height = total_height - ((b - a) * cell_height) - hole0_height;
    hole0.style.height = hole0_height + 'px';
    hole1.style.height = hole1_height + 'px';
  }

  document.addEventListener("scroll", function(x) { layout(); });
  window.addEventListener("resize", function(x) { layout(); });

  div.addEventListener('click', (function() { return function(e) {
    for (var target = e.target; target !== div; target = target.parentNode) {
      if (target.cell_id !== undefined) {
        var new_node = this_.build_expanded(target.cell_id);
        if (new_node === null) break;
        empty_layout();
        expanded_node = new_node;
        expanded_id = target.cell_id;
        layout();
        break;
      }
    }
  };})());

  div.appendChild(hole0);
  div.appendChild(hole1);

  this.layout = function() { layout(); };
  this.div = div;
}

function build_nav_bar(cb) {
  var div = ce('div');
  div.className = "usbbare-nav";
  var packets = text_span('packets', {marginRight: '2em', borderBottom: '1px solid black', cursor: 'default'});
  var transactions = ce('span', {marginRight: '2em', cursor: 'default'});
  transactions.appendChild(text_span('transactions', {marginRight: 0}));
  var orb = text_span('\u25CF', {position: 'relative', left: '0.15em', top: '0.033em'});
  transactions.appendChild(orb);

  var cur_view = 0;

  var link_nodes = [packets, transactions.firstChild];

  var orb_state = 0;

  packets.addEventListener('click', function(e) {
    link_nodes[cur_view].style.borderBottom = 0;
    if (cur_view !== 0) cb(cur_view, 0, orb_state);
    cur_view = 0;
    link_nodes[cur_view].style.borderBottom = '1px solid black';
    e.preventDefault();
    return false;
  });

  transactions.addEventListener('click', function(e) {
    if (cur_view === 1) {
      orb_state = (orb_state + 1) % 3;
      orb.style.color = ["#000", "#090", "#900"][orb_state];
      //orb.textContent = ['\u25CF', '\u25D0', '\u25D1'][orb_state];
      cb(cur_view, 1, orb_state);
    } else {
      link_nodes[cur_view].style.borderBottom = 0;
      if (cur_view !== 1) cb(cur_view, 1, orb_state);
      cur_view = 1;
      link_nodes[cur_view].style.borderBottom = '1px solid black';
    }
    e.preventDefault();
    return false;
  });

  div.appendChild(packets);
  div.appendChild(transactions);
  div.appendChild(text_span('transfers'));
  return div;
}

function build_ui(packets, transactions, transactions_succ, transactions_fail) {
  var transaction_panel = document.createElement('div');
  transaction_panel.className = "usbbare-tp";
  transaction_panel.style.display = "none";

  var packet_display_node = document.createElement('div');
  packet_display_node.className = "usbbare-p";

  var kCellHeight = 18;
  var packet_view = new LazyTable(kCellHeight, packets);
  packet_view.div.className = "usbbare-p-list";

  packet_view.build_cell = function(id) {
    var cell = build_packet_line(packets[id], id, kCellHeight + 'px');
    return cell;
  };

  packet_view.build_expanded = function(id) {
    build_packet_display(packet_display_node, packets[id]);
    return packet_display_node;
  };

/*
        selected = target.packet_num;
        var tid = packets[selected].transaction_id;
        if (tid !== cur_transaction_id) {
          if (tid !== null) {
            build_transaction_display(transaction_panel, transactions[tid], tid);
            transaction_panel.style.display = "block";
          } else {
            transaction_panel.style.display = "none";
          }
          cur_transaction_id = tid;
        }
*/

  function trans_table(trans) {
    var view = new LazyTable(kCellHeight, trans);
    view.div.className = "usbbare-tr-list";
    view.build_cell = function(pos) {
      var tr = trans[pos];
      var cell = build_transaction_line(tr, tr.id, kCellHeight + 'px');
      return cell;
    };

    view.build_expanded = function(pos) {
      build_transaction_display(packet_display_node, trans[pos]);
      return packet_display_node;
    };
    return view;
  }

  var transaction_view = trans_table(transactions);
  var transaction_succ_view = trans_table(transactions_succ);
  var transaction_fail_view = trans_table(transactions_fail);

  packet_view.layout();
  transaction_view.layout()

  var view_nodes = [
    packet_view,
    [transaction_view, transaction_succ_view, transaction_fail_view]];
  var cur_view_node = view_nodes[0];

  document.body.appendChild(build_nav_bar(function(old_id, new_id, orb_id) {
    document.body.removeChild(cur_view_node.div);
    var new_node = view_nodes[new_id];
    if (Array.isArray(new_node)) new_node = new_node[orb_id];
    document.body.appendChild(new_node.div);
    new_node.layout();
    cur_view_node = new_node;
  }));

  document.body.appendChild(cur_view_node.div);
}

window.onload = function() {
  var transaction_machine = new usb_machines.TransactionMachine();

  var transactions = [ ];
  var transactions_succ = [ ];
  var transactions_fail = [ ];

  transaction_machine.OnEmit = function(transtype, typename, success, out, state) {
    var transaction_id = state.id;
    //console.log(["emit", typename, out, state.id]);
    //console.log(["emit", typename, success, state.id]);
    var ids = state.ids;
    var succ_bit = success === true ? 1 : 0;

    if (success === true && ids.length !== 3)
      console.log("Warning: Successful transaction doesn't have 3 packets: " + transaction_id);

    for (var i = 0, il = ids.length; i < il; ++i) {
      var packet_id = ids[i];
      if (packet_id > packets.length || packet_id < 0) throw packet_id;
      if (packets[packet_id] === undefined) throw packet_id;
      packets[packet_id].transaction_id = transaction_id << 1 | succ_bit;
    }

    var tr = {id: transaction_id,
              typename: typename,
              success: success,
              out: out,
              ids: ids,
              t: packets[ids[0]].t /* TODO handle overflow */};
    transactions.push(tr);
    (success === true ? transactions_succ : transactions_fail).push(tr);
  };

  console.log('Running transaction state machine...');
  for (var i = 0, il = packets.length; i < il; ++i) {
    var p = packets[i];
    var rp = p.d;
    var res = null;
    if (rp.length !== 0) res = transaction_machine.process_packet(rp, i);
  }
  console.log('...done');

  build_ui(packets, transactions, transactions_succ, transactions_fail);
};
