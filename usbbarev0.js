var decoder = require('./packet_decoder.js');
var usb_machines = require('./usb_machines.js');
var usb_structs = require('./usb_structs.js');
var crclib  = require('./crc.js');
var saveAs  = require('./FileSaver.min.js');

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

function stopprop(e) {
  e.stopPropagation();
  e.preventDefault();
  return false;
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

function hex_dump_chunked(data, cols) {
  var str = '';
  var lp = 0;
  for (var j = 0, jl = data.length; j < jl; j += 2) {
    var subdata = data[j];  // TODO handle meta data.
    for (var i = 0, il = subdata.length; i < il; ++i) {
      var hex = subdata[i].toString(16);
      if (lp >= cols) {
        str += "\n";
        lp = 0;
      }
      if (hex.length < 2) hex = "0" + hex;
      if (lp !== 0) str += ' ';
      str += hex;
      ++lp;
    }
  }
  return str;
}

function flatten_chunked(data) {
  var total_len = 0;
  for (var i = 0, il = data.length; i < il; i += 2) total_len += data[i].length;
  var flat = new Uint8Array(total_len);
  var p = 0;
  for (var i = 0, il = data.length; i < il; i += 2) {
    flat.set(data[i], p);
    p += data[i].length;
  }
  return flat;
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

// Bit gnarly, try to look up subclass and interface names.
function look_up_interface_and_set_names(iface) {
  if (!iface) return;
  var iface1 = iface.get_display_at(5);
  if (!iface1) return;
  var iface2 = usb_structs["eInterfaceSubclass" + iface1];
  if (!iface2) return;
  var iface3 = iface2[iface.get_value_at(6)];
  if (!iface3) return;
  iface.set_display_at(6, iface3);
  var iface4 = usb_structs["eInterfaceSubclass" + iface1 + "Protocol" + iface3];
  if (!iface4) return;
  var iface5 = iface4[iface.get_value_at(7)];
  if (!iface5) return;
  iface.set_display_at(7, iface5);
}

function disect_device_desc(n, flat_data) {
  var desc = new usb_structs.Fields();
  if (usb_structs.parse_StandardDeviceDescriptor(
      desc, flat_data, 0, flat_data.length) === false) {
    n.appendChild(text_div("failed to parse device desc", 6, 15));
    return;
  }

  n.appendChild(text_div("DEVICE", 2));
  if (desc.get_value("bDeviceClass") === 9 /* HUB_CLASSCODE */ &&
      desc.get_value("bDeviceSubClass") === 0) {
    desc.set_display_at(3, "HUB");
    desc.set_display_at(5,
        ["FullSpeed", "HighSpeedSingleTT", "HighSpeedMultipleTT"][desc.get_value_at(5)]);
  }

  n.appendChild(build_table_from_fields(desc));
}

function disect_config_desc(n, flat_data) {
  var descriptor = new usb_structs.Fields();
  if (usb_structs.parse_StandardConfigurationDescriptor(
      descriptor, flat_data, 0, flat_data.length) === false) {
    n.appendChild(text_div("failed to parse config descriptor", 6, 15));
    return;
  }

  n.appendChild(text_div("CONFIGURATION", 2));
  n.appendChild(build_table_from_fields(descriptor));

  var num_interfaces = descriptor.get_value("bNumInterfaces");
  var tlen = descriptor.get_value("wTotalLength");
  var pos = 0;
  pos += descriptor.get_value("bLength");

  for (var i = 0; i < num_interfaces && pos < tlen; ++i) {
    if (flat_data[pos+1] !== 4) {  // INTERFACE
      n.appendChild(text_div("Skipped unknown descriptor: " + flat_data[pos+1], 6, 15));
      --i;
      pos += flat_data[pos];
      continue;
    }

    var iface = new usb_structs.Fields();
    if (usb_structs.parse_StandardInterfaceDescriptor(
        iface, flat_data, pos, flat_data.length) === false) {
      n.appendChild(text_div("failed to parse interface descriptor", 6, 15));
      return;
    }

    n.appendChild(text_div("INTERFACE", 2));

    // Gnarly, try to look up subclass and interface names.
    look_up_interface_and_set_names(iface);

    n.appendChild(build_table_from_fields(iface));
    pos += iface.get_value("bLength");

    var num_eps = iface.get_value("bNumEndpoints");
    for (var j = 0; j < num_eps && pos < tlen; ++j) {
      if (flat_data[pos+1] !== 5) {  // ENDPOINT
        n.appendChild(text_div("Skipped unknown descriptor: " + flat_data[pos+1], 6, 15));
        --j;
        pos += flat_data[pos];
        continue;
      }

      var ep = new usb_structs.Fields();
      if (usb_structs.parse_StandardEndpointDescriptor(
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

function build_transaction_display(n, tr) {
  while (n.firstChild) n.removeChild(n.firstChild);

  n.appendChild(text_div('Type: ' + tr.typename));
  n.appendChild(text_div('Success: ' + ((tr.id & 1) ? 'true' : 'false')));
  n.appendChild(text_div('Packet IDs: ' + tr.packets.map(function(x) { return x.id >> 1; })));
  var out = tr.out;
  for (key in out) {
    if (key.substr(key.length - 2) === "_m") continue;
    if (key === "setup" && typeof out[key] === "object") {
      n.appendChild(build_table_from_fields(out.setup));
      continue;
    }
    if (key === "data" && out[key] !== undefined) {
      n.appendChild(text_div(hex_dump(out[key], 16)));
      continue
    }
    n.appendChild(text_div(key + ': ' + out[key]));
  }

  //n.appendChild(text_span(JSON.stringify(tr)));
}

function build_control_transfer_display(n, tr) {
  var setup = tr.out.setup;
  if (setup === undefined) return;

  var type = decode_control_transfer_setup(setup, false);
  n.appendChild(text_div("Setup: " + type, 2));
  n.appendChild(build_table_from_fields(setup));

  var data = tr.out.data;
  if (data === undefined || data.length === 0) return;
  var flat_data = flatten_chunked(data);

  switch (type) {
    case "GET_DESCRIPTOR":
      var wvalue = setup.get_value("wValue");
      var desctype = wvalue >> 8, descidx = wvalue & 0xff;

      n.appendChild(text_div("Descriptor Type: " + desctype +
                             " (" + usb_structs.eDescriptorTypes[desctype] + ")"), 5);
      n.appendChild(text_div("Descriptor Index: " + descidx),  5);

      switch (desctype) {
        case 1:  // DEVICE
          disect_device_desc(n, flat_data);
          break;
        case 2:  // CONFIGURATION
          disect_config_desc(n, flat_data);
          break;
        case 3:  // STRING
          if (flat_data[1] !== 3) {
            console.log("Unknown string descriptor constant");
            return;
          }
          var ustr_len = flat_data[0] - 2;
          var ustr = '';
          for (var i = 0; i*2+3 < flat_data.length && i < ustr_len; ++i) {
            ustr += String.fromCharCode(flat_data[i*2+2] | flat_data[i*2+3] << 8);
          }
          n.appendChild(text_div("Descriptor String:"));
          n.appendChild(text_div(ustr, 5, 15));
          break;
        default:
          n.appendChild(text_div(usb_structs.eDescriptorTypes[desctype], 2));
          break;
      }
      break;

    case "GetHubStatus":
      var hubstatus = new usb_structs.Fields();
      if (usb_structs.parse_HubStatus(
          hubstatus, flat_data, 0, flat_data.length) === false) {
        n.appendChild(text_div("failed to parse hub status", 6, 15));
        return;
      }

      n.appendChild(text_div("Hub Status: " + type, 2));
      n.appendChild(build_table_from_fields(hubstatus));

      break;

    case "GetPortStatus":
      var portstatus = new usb_structs.Fields();
      if (usb_structs.parse_HubPortStatus(
          portstatus, flat_data, 0, flat_data.length) === false) {
        n.appendChild(text_div("failed to parse port status", 6, 15));
        return;
      }

      n.appendChild(text_div("Port Status: " + type, 2));
      n.appendChild(build_table_from_fields(portstatus));
      break;
  }
}

function build_transfer_display(n, tr) {
  while (n.firstChild) n.removeChild(n.firstChild);

  n.appendChild(text_div('Type: ' + tr.typename));
  n.appendChild(text_div('Success: ' + tr.success));
  n.appendChild(text_div('Transaction IDs: ' + tr.transactions.map(function(x) { return x.id >> 1; })));
  var out = tr.out;
  for (key in out) {
    if (key.substr(key.length - 2) === "_m") continue;
    if (key === "setup" && typeof out[key] === "object") continue;
    if (key === "data" && Array.isArray(out[key])) continue;
    n.appendChild(text_div(key + ': ' + out[key]));
  }

  if (tr.typename === "ControlTransfer")
    build_control_transfer_display(n, tr);

  if (Array.isArray(out.data)) {
    var num_chunks = out.data.length / 2;
    var total_len = 0;
    for (var i = 0, il = out.data.length; i < il; i += 2) total_len += out.data[i].length;
    n.appendChild(text_div("Data num chunks: " + num_chunks + " total length: " + total_len, 2));
    n.appendChild(text_div(hex_dump_chunked(out.data, 16), 0, 15));
  }

  //n.appendChild(text_span(JSON.stringify(tr)));
}

function build_bit_display(name, num_bits, val, badbits, dispstr) {
  var span = ce('span');
  span.className = "usbbare-bitfield";
  span.title = name + ': ' + val + (dispstr ? ' (' + dispstr + ')' : '');

  var html = '';

  for (var i = 0; i < num_bits; ++i) {
    if (badbits & 1) {
      html = '<span class="bad">' + (val & 1) + '</span>' + html;
    } else {
      html = (val & 1) + html;
    }
    val >>= 1;
    badbits >>= 1;
  }

  span.innerHTML = html;

  return span;
}

function build_packet_display(n, p) {
  while (n.firstChild) n.removeChild(n.firstChild);

  var rawdata = g_reader.rawdata;
  g_reader.seek_to_packet(p.p);

  var plen = g_reader.read_plen();
  var p = g_reader.packet_pos();

  var pp = plen === 0 ? null : decoder.decode_packet(rawdata, p, plen);

  if (pp === null) {
    n.innerText = 'ERROR: Packet undecoded.';
    return;
  }

  //n.appendChild(text_div(JSON.stringify(d)));

  var pid = rawdata[p];

  var pid_type = pid & 3;
  var pid_name = (pid >> 2) & 3;
  var pid_type_str = ["special", "token", "handshake", "data"][pid_type];
  var pid_name_str = kPidNameTable[pid & 0xf];

  n.appendChild(make_field("PID", 4, [
      build_bit_display("pid_type", 2, pid_type, 0, pid_type_str),
      build_bit_display("pid_name", 2, pid_name, 0, pid_name_str)]));

  var npid_type = (pid >> 4) & 3;
  var npid_name = (pid >> 6) & 3;
  n.appendChild(make_field("NPID", 4, [
      build_bit_display("npid_type", 2, npid_type, pid_type^~npid_type, null),
      build_bit_display("npid_name", 2, npid_name, pid_name^~npid_name, null)]));

  if (ppid_type === 1 || (ppid_type === 0 && ppid_name === 1)) {  // Token
    if (ppid_type === 1 && ppid_name === 1) {  // SOF
      n.appendChild(make_field("FrameNumber", 11,
        [make_bit_field_node("FrameNumber", pp.FrameNumber, to_bin_str(11, pp.FrameNumber))]));
    } else {
      n.appendChild(make_field("ADDR", 6,
        [make_bit_field_node("ADDR", pp.ADDR, to_bin_str(7, pp.ADDR))]));
      n.appendChild(make_field("EndPoint", 5,
        [make_bit_field_node("EndPoint", pp.EndPoint, to_bin_str(4, pp.EndPoint))]));
    }
    var crc = crclib.crc5_16bit(rawdata[p+1], rawdata[p+2]);
    n.appendChild(make_field("CRC5", 4, [
        build_bit_display("CRC5", 5, pp.CRC5, crc^6, null)]));
  } else if (ppid_type === 3) {  // Data
    n.appendChild(make_field("DATA", 4,
      [make_bit_field_node("data length", pp.data.length, "...")]));
    var crc = crclib.crc16(rawdata, p+1, p+plen);
    n.appendChild(make_field("CRC16", 4, [
        build_bit_display("CRC16", 16, pp.CRC16, crc^0xb001, null)]));
  } else if (ppid_type === 0 && ppid_name === 2) {  // SPLIT
    n.appendChild(make_field("HubAddr", 4, [
        build_bit_display("HubAddr", 7, pp.HubAddr, 0, null)]));
    n.appendChild(make_field("SC", 2, [
        build_bit_display("SC", 1, pp.SC, 0, pp.SC ? "Complete" : "Start")]));
    n.appendChild(make_field("Port", 4, [
        build_bit_display("Port", 7, pp.Port, 0, null)]));
    n.appendChild(make_field("S", 2, [
        build_bit_display("S", 1, pp.S, 0, pp.S ? "Low Speed" : "Full Speed")]));
    n.appendChild(make_field("E/U", 2, [
        build_bit_display("EU", 1, pp.EU, 0, null)]));
    n.appendChild(make_field("ET", 2, [
        build_bit_display("ET", 2, pp.ET, 0, ["Control", "Isochronous", "Bulk", "Interrupt"][pp.ET])]));
    var crc = crclib.crc5_24bit(rawdata[p+1], rawdata[p+2], rawdata[p+3]);
    n.appendChild(make_field("CRC5", 4, [
        build_bit_display("CRC5", 5, pp.CRC5, crc^6, null)]));
  }
  //n.appendChild(text_div(p.transaction_ids));
}

function build_packet_row(p, height) {
  var row = document.createElement('div');
  row.className = 'usbbare-row';
  row.style.height = height;

  var n = document.createElement('span');
  var ts = document.createElement('span');
  var desc = document.createElement('span');

  n.innerText = p.id >> 1;
  n.style.color = (p.id & 1) ? "#090" : "#900";

  ts.innerText = p.t;

  var desc_str = p.f !== 0 ? "\u2691" : '';

  var rawdata = g_reader.rawdata;

  var pp = p.plen === 0 ? null : decoder.decode_packet(rawdata, p.p, p.plen);
  if (pp !== null)
    desc_str += decode_packet_to_display_string(pp, rawdata, p.p, p.plen);

  desc.innerText = desc_str;

  row.appendChild(n);
  row.appendChild(ts);
  row.appendChild(desc);
  return row;
}

function build_transaction_row(tr, height) {
  var row = document.createElement('div');
  row.className = 'usbbare-row';
  row.style.height = height;
  var n = document.createElement('span');
  var ts = document.createElement('span');
  var desc = document.createElement('span');
  n.style.color = (tr.id & 1) ? "#090" : "#900";
  n.innerText = tr.id >> 1; ts.innerText = tr.t;
  desc.innerText = tr.typename;
  row.appendChild(n); row.appendChild(ts);
  row.appendChild(desc);
  return row;
}

function decode_control_transfer_setup(setup, justdisp) {
  // TODO: figure out how to do this cleaner than putting it all back together.
  var requesttype_and_request =
    setup.get_value_at(0) << 8 | setup.get_value_at(1) << 13 | setup.get_value_at(2) << 15 |
    setup.get_value_at(3);

  switch (setup.get_value("bmRequestType.type")) {
    case 0:  // Standard
      var display = usb_structs.eStandardDeviceRequests[requesttype_and_request];
      if (justdisp) return display;

      return display;
      break;

    case 1:  // Class
      var display = usb_structs.eClassSpecificRequests[requesttype_and_request];
      if (display === undefined)
        display = usb_structs.eClassSpecificHIDRequests[requesttype_and_request];
      if (justdisp) return display;

      switch (display) {
        case "ClearHubFeature":
        case "SetHubFeature":
          setup.set_display_at(4, usb_structs.eHubClassFeatureSelectorsHub[setup.get_value_at(4)]);
          break;
        case "ClearPortFeature":
        case "SetPortFeature":
          setup.set_display_at(4, usb_structs.eHubClassFeatureSelectorsPort[setup.get_value_at(4)]);
          break;
      }

      return display;
      break;
  }

  return undefined;
}

function build_transfer_row(tr, height) {
  var row = document.createElement('div');
  row.className = 'usbbare-row';
  row.style.height = height;
  var n = document.createElement('span');
  var ts = document.createElement('span');
  var desc = document.createElement('span');
  n.style.color = (tr.id & 1) ? "#090" : "#900";
  n.innerText = tr.id >> 1; ts.innerText = tr.t;

  var desc_str = tr.out.ADDR + ':' + tr.out.EndPoint + ' ' + tr.typename;
  // "ControlTransfer (SET_ADDRESS)", etc.
  if (tr.typename === "ControlTransfer" && tr.out.setup) {
    desc_str = (tr.out.setup.get_value_at(2) ? "\u2190 " : "\u2192 ") + desc_str;
    var display = decode_control_transfer_setup(tr.out.setup, true);
    if (display !== undefined) desc_str += " " + display;
  }

  desc.innerText = desc_str;
  row.appendChild(n); row.appendChild(ts);
  row.appendChild(desc);
  return row;
}

function LazyTable(cell_height, num_cells) {
  var this_ = this;

  var total_height = num_cells * cell_height;

  var div = ce('div');

  var hole0 = ce('div', {backgroundColor: 'blue', height: 0})
  var hole1 = ce('div', {backgroundColor: 'red',  height: total_height + 'px'})

  var a = 0;
  var b = 0;

  var expanded_id = null;
  var expanded_node = null;

  var select_div = ce('div',
      {backgroundColor: "#eee", width: "40em", height: "18px", display: "none",
       position: "absolute", top: 0, left: 0, zIndex: -1});

  var selected = null;

  var i = 0;

  this.select = function(p) { 
    if (p === selected) return;

    if (p === null) {
      select_div.style.display = "none";
      selected = p;
      return;
    }

    if (p >= num_cells) p = num_cells-1;
    if (p < 0) p = 0;

    select_div.style.display = "block";
    select_div.style.top = (p * cell_height) + 'px';
    selected = p;
  };

  this.clear_selection = function() {
    this.select(null);
  };

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

  this.build_cell_internal = function(id) {
    var cell = this.build_cell(id);
    cell.cell_id = id;
    return cell;
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
      var cell = this_.build_cell_internal(a);
      div.insertBefore(cell, hole0.nextSibling);
    }

    while (b < d && b < num_cells) {  // adding elements to the bottom
      var cell = this_.build_cell_internal(b);
      div.insertBefore(cell, hole1);
      if (b === expanded_id) div.insertBefore(expanded_node, hole1);
      ++b;
    }

    var hole0_height = a * cell_height;
    var hole1_height = total_height - ((b - a) * cell_height) - hole0_height;
    hole0.style.height = hole0_height + 'px';
    hole1.style.height = hole1_height + 'px';
  }

  div.setAttribute("tabindex", 0);

  div.addEventListener("keydown", function(e) {
    if (e.which !== 40 && e.which !== 38) return true;

    if (selected !== null) {
      var new_pos = selected + (e.which === 40 ? 1 : -1);
      this_.select(new_pos);
      new_node = this_.build_expanded(selected);
    }

    return stopprop(e);
  });

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

  var container = ce('div');
  container.className = "usbbare-lazytable-container";
  container.appendChild(select_div);
  container.appendChild(div);

  this.div = div;
  this.container = container;
}

function build_nav_bar(cb) {
  var div = ce('div');
  div.className = "usbbare-nav";

  var packets = ce('span', {marginRight: '2em', cursor: 'default'});
  var packets_orb = text_span('\u25CF', {position: 'relative', left: '-0.15em', top: '0.033em'});
  packets.appendChild(packets_orb);
  packets.appendChild(text_span('packets', {marginRight: 0}));

  var transactions = ce('span', {marginRight: '2em', cursor: 'default'});
  var transactions_orb = text_span('\u25CF', {position: 'relative', left: '-0.15em', top: '0.033em'});
  transactions.appendChild(transactions_orb);
  transactions.appendChild(text_span('transactions', {marginRight: 0}));

  var transfers = ce('span', {marginRight: '2em', cursor: 'default'});
  var transfers_orb = text_span('\u25CF', {position: 'relative', left: '-0.15em', top: '0.033em'});
  transfers.appendChild(transfers_orb);
  transfers.appendChild(text_span('transfers', {marginRight: 0, borderBottom: '1px solid black'}));

  var cur_view = 2;

  var link_nodes = [packets.lastChild, transactions.lastChild, transfers.lastChild];

  var orbs = [packets_orb, transactions_orb, transfers_orb];
  var orb_states = [0, 0, 0];

  function handle_click(view_id) {
    return function(e) {
      if (cur_view === view_id) {
        orb_states[view_id] = (orb_states[view_id] + 1) % 3;
        orbs[view_id].style.color = ["#000", "#090", "#900"][orb_states[view_id]];
        //orb.textContent = ['\u25CF', '\u25D0', '\u25D1'][orb_state];
        cb(cur_view, view_id, orb_states[view_id]);
      } else {
        link_nodes[cur_view].style.borderBottom = 0;
        if (cur_view !== view_id) cb(cur_view, view_id, orb_states[view_id]);
        cur_view = view_id;
        link_nodes[cur_view].style.borderBottom = '1px solid black';
      }
      e.preventDefault();
      return false;
    };
  }

  packets.addEventListener('click', handle_click(0));
  transactions.addEventListener('click', handle_click(1));
  transfers.addEventListener('click', handle_click(2));

  div.appendChild(packets);
  div.appendChild(transactions);
  div.appendChild(transfers);

  return div;
}

function build_ui(
    packets, packets_succ, packets_fail,
    transactions, transactions_succ, transactions_fail,
    transfers, transfers_succ, transfers_fail) {

  var panel = document.createElement('div');
  panel.style.zIndex = 2;
  panel.className = "usbbare-panel";
  panel.style.display = "none";

  var packet_display_node = document.createElement('div');
  packet_display_node.className = "usbbare-p";

  var kCellHeight = 18;

  function packet_table(pkts) {
    var view = new LazyTable(kCellHeight, pkts.length);
    view.div.className = "usbbare-list";

    view.build_cell = function(pos) {
      var cell = build_packet_row(pkts[pos], kCellHeight + 'px');
      return cell;
    };

    view.build_expanded = function(pos) {
      build_packet_display(panel, pkts[pos]);
      panel.style.display = "block";
      view.select(pos);
      return null;  // Not inline in the list view.
    };
    return view;
  }

  function trans_table(trans) {
    var view = new LazyTable(kCellHeight, trans.length);
    view.div.className = "usbbare-list";
    view.build_cell = function(pos) {
      var tr = trans[pos];
      var cell = build_transaction_row(tr, kCellHeight + 'px');
      return cell;
    };

    view.build_expanded = function(pos) {
      build_transaction_display(panel, trans[pos]);
      panel.style.display = "block";
      view.select(pos);
      return null;  // Not inline in the list view.
    };
    return view;
  }

  function tfer_table(tfer) {
    var view = new LazyTable(kCellHeight, tfer.length);
    view.div.className = "usbbare-list";
    view.build_cell = function(pos) {
      var tr = tfer[pos];
      var cell = build_transfer_row(tr, kCellHeight + 'px');
      return cell;
    };

    view.build_expanded = function(pos) {
      build_transfer_display(panel, tfer[pos]);
      panel.style.display = "block";
      view.select(pos);
      return null;  // Not inline in the list view.
    };
    return view;
  }

  var packet_view = packet_table(packets);
  var packet_succ_view = packet_table(packets_succ);
  var packet_fail_view = packet_table(packets_fail);

  var transaction_view = trans_table(transactions);
  var transaction_succ_view = trans_table(transactions_succ);
  var transaction_fail_view = trans_table(transactions_fail);

  var transfer_view = tfer_table(transfers);
  var transfer_succ_view = tfer_table(transfers_succ);
  var transfer_fail_view = tfer_table(transfers_fail);

  var view_nodes = [
    [packet_view, packet_succ_view, packet_fail_view],
    [transaction_view, transaction_succ_view, transaction_fail_view],
    [transfer_view, transfer_succ_view, transfer_fail_view],
  ];
  var cur_view_node = view_nodes[2][0];

  var nav_bar = build_nav_bar(function(old_id, new_id, orb_id) {
    document.body.removeChild(cur_view_node.container);
    var new_node = view_nodes[new_id][orb_id];
    document.body.appendChild(new_node.container);
    new_node.clear_selection();
    new_node.layout();
    cur_view_node = new_node;
  });

  cur_view_node.layout();

  document.addEventListener("scroll", function(x) { cur_view_node.layout(); });
  window.addEventListener("resize", function(x) { cur_view_node.layout(); });


  document.body.appendChild(nav_bar);
  document.body.appendChild(panel);
  document.body.appendChild(cur_view_node.container);
}

function decode_packet_to_display_string(dp, buf, p, plen) {
  var pid_type = dp.pid_type, pid_name = dp.pid_name;

  var text = null;
  switch (pid_type) {
    case 0:
      switch (pid_name) {
        case 0:
          text = "special RESERVED";
          break;
        case 1:
          text = "special PING ADDR: " + dp.ADDR + " EndPoint: " + dp.EndPoint;
          break;
        case 2:
          text = (dp.SC ? "special CSPLIT " : "special SSPLIT ") + dp.HubAddr + ":" + dp.Port +
              " (" + ["Control", "Isochronous", "Bulk", "Interrupt"][dp.ET] + ")";
          break;
        case 3:
          text = "special PRE/ERR";
          break;
      }
      break;

    // Token packets:
    //   Sync PID ADDR ENDP CRC5 EOP
    // Start of Frame Packets:
    //   Sync PID Frame Number CRC5 EOP
    case 1:
      if (plen != 3) return "ERROR: token packet length != 3";
      text = "token " + ["OUT", "SOF", "IN", "SETUP"][pid_name] + ((pid_name === 1) ?
                " FrameNumber: " + dp.FrameNumber :
                " ADDR: " + dp.ADDR + " EndPoint: " + dp.EndPoint);
      break;

    // Handshake packets:
    //   Sync PID EOP
    case 2:
      if (plen != 1) return "ERROR: handshake packet length != 1";
      text = "handshake " + ["ACK", "NYET", "NAK", "STALL"][pid_name];
      break;

    // Data packets:
    //   Sync PID Data CRC16 EOP
    case 3:
      if (plen < 3) return "ERROR: data packet length < 3";
      text = "data " + ["DATA0", "DATA2", "DATA1", "MDATA"][pid_name] + " len " + (plen-3);
      break;
  }

  return text;
}

function PacketReader(rawdata) {
  this.isEOF = function() { };

  // Reset to the first packet.
  this.reset = function() { };

  this.read_time = function() { };
  this.read_flags = function() { };
  // Return the length of just the USB packet (not including flags, etc).
  this.read_plen = function() { };
  // Return the position of just the USB packet, of length |plen|.
  this.packet_pos = function() { };

  // Move to the next packet.
  this.advance = function() { };
}

// Minimal binary file format, no header, just a repeated sequence of:
//   [ 2 bytes flags ] [ 3 bytes timestamp ] [ 2 bytes packet len ] [ data ]
function MinBinPacketReader(rawdata) {
  this.rawdata = rawdata;

  var p = 0;
  var len = rawdata.length;

  this.isEOF = function() { return p >= len; };
  this.reset = function() { p = 0; };

  // Position is of the packet data (packet_pos()), so we have to go backwards from there.
  this.seek_to_packet = function(np) {
    p = np - 7;
  };

  this.read_time = function() {
    return rawdata[p+2] | rawdata[p+3] << 8 | rawdata[p+4] << 16;
  };

  this.read_flags = function() {
    return rawdata[p] | rawdata[p+1] << 8;
  };

  this.read_plen = function() {
    return rawdata[p+5] | rawdata[p+6] << 8;
  };

  this.packet_pos = function() {
    return p + 7;
  };

  this.advance = function() { p += this.read_plen() + 7; };

  this.estimate_percentage = function() { return p / len; };
}

function PcapReader(rawdata) {
  this.rawdata = rawdata;

  var p = 0;
  var len = rawdata.length;

  if (!(len > 24 && rawdata[0] == 0xD4 &&
                    rawdata[1] == 0xC3 &&
                    rawdata[2] == 0xB2 &&
                    rawdata[3] == 0xA1)) {
    throw "Not a valid pcap file.";
  }

  p = 24;  // skip pcap header

  this.isEOF = function() { return p >= len; };
  this.reset = function() { p = 0; };

  // Position is of the packet data (packet_pos()), so we have to go backwards from there.
  this.seek_to_packet = function(np) {
    p = np - 18;
  };

  // NOTE(deanm): A shift << 24 is fragile because this will be interpreted as
  // signed.  in JavaScript 1 << 31 is -2147483648.  The last octet should be
  // handled with add + mul to go into double size :(
  function read_uint32_le(p) {
    return (rawdata[p+0] | rawdata[p+1] << 8 | rawdata[p+2] << 16) + rawdata[p+3] * 0x1000000;
  }

  this.read_time = function() {
    var ts_sec = read_uint32_le(p);
    var ts_usec = read_uint32_le(p+4)
    return ts_sec + ts_usec / 1e6;
  };

  this.read_flags = function() {
    return rawdata[p+16] | rawdata[p+17] << 8;
  };

  this.read_plen = function() {
    var incl_len = read_uint32_le(p+8);
    var orig_len = read_uint32_le(p+12);
    if (incl_len !== orig_len) throw "incl_len !== orig_len";
    if (incl_len < 2) throw "incl_len < 2";
    return incl_len - 2;
  };

  this.packet_pos = function() {
    return p + 18;
  };

  this.advance = function() { p += this.read_plen() + 18; };

  this.estimate_percentage = function() { return p / len; };
}

function make_packet_reader(rawdata) {
  var readers = [ PcapReader, MinBinPacketReader ];

  for (var i = 0, il = readers.length; i < il; ++i) {
    var reader = readers[i];
    try {
      return new reader(rawdata);
    } catch(e) { }
  }

  throw "No reader was able to handle file.";
}

// Decode packets from a reader, calling |cb| for each packet.
// Processes in blocks so that the UI loop can keep running, after a block
// is finished the next one is queued on the runloop, so it is a bit "async".
function block_decode_packets(blockmask, reader, cb) {
  var rawdata = reader.rawdata;

  var i = 0;

  function process_block() {
    while (true) {
      if (reader.isEOF() === true) {
        cb(true);
        break;
      }

      var time = reader.read_time();
      var flags = reader.read_flags();
      var plen = reader.read_plen();
      var p = reader.packet_pos();
      var pp = plen === 0 ? null : decoder.decode_packet(rawdata, p, plen);

      var success =
        pp !== null &&  // Check decode
        (pp.CRC5 === undefined ||  // Check CRC5
          ((plen === 3 && crclib.crc5_16bit(rawdata[p+1], rawdata[p+2]) === 6) ||
           (plen === 4 && crclib.crc5_24bit(rawdata[p+1], rawdata[p+2], rawdata[p+3]) === 6))) &&
        (pp.CRC16 === undefined ||  // Check CRC16
          (plen >= 3 && crclib.crc16(rawdata, p+1, p+plen) === 0xb001));

      cb(false, i, i & blockmask, time, flags, plen, p, pp, success);

      reader.advance();

      ++i;

      if ((i & blockmask) === 0) {
        setTimeout(process_block, 0);
        break;
      }
    }
  }

  process_block();
}

var g_reader;

function process_and_init(rawdata) {
  var reader = make_packet_reader(rawdata);
  g_reader = reader;

  var transaction_machine = new usb_machines.TransactionMachine();
  var transfer_machine = new usb_machines.TransferMachine();

  var loading = ce('div',
    {height: '100%', width: '100%',
     backgroundColor: 'purple', color: 'white', fontSize: '8em'});
  loading.innerText = 'loading...'
  document.body.appendChild(loading);

  var packets = [ ];
  var packets_succ = [ ];
  var packets_fail = [ ];

  var transactions = [ ];
  var transactions_succ = [ ];
  var transactions_fail = [ ];

  transaction_machine.OnEmit = function(transtype, typename, success, out, state) {
    var pkts = state.packets;
    var succ_bit = success === true ? 1 : 0;
    var transaction_id = transactions.length << 1 | succ_bit;

    /*
    for (var i = 0, il = pkts.length; i < il; ++i) {
      if (pkts[i].transaction_ids === undefined) pkts[i].transaction_ids = [ ];
      pkts[i].transaction_ids.push(transaction_id);
    }
    */

    var tr = {id: transaction_id,
              typename: typename,
              success: success,
              out: out,
              packets: pkts,
              t: pkts[0].t /* TODO handle overflow */};
    transactions.push(tr);
    (success === true ? transactions_succ : transactions_fail).push(tr);

    if (success === true) transfer_machine.process_transaction(tr, tr);
  };

  var transfers = [ ];
  var transfers_succ = [ ];
  var transfers_fail = [ ];

  transfer_machine.OnEmit = function(transtype, typename, success, out, state) {
    var transactions = state.transactions;
    var succ_bit = success === true ? 1 : 0;
    var transfer_id = transfers.length << 1 | succ_bit;

    /*
    for (var i = 0, il = transactions.length; i < il; ++i) {
      transactions[i].transfer_id = transfer_id;
    }
    */

    var tr = {id: transfer_id,
              typename: typename,
              success: success,
              out: out,
              transactions: transactions,
              t: transactions[0].t /* TODO handle overflow */};
    transfers.push(tr);
    (success === true ? transfers_succ : transfers_fail).push(tr);
  };

  // Keep the browser happy by processing in chunks and keep the UI loop alive.

  console.log('Decoding packets and running state machines...');

  block_decode_packets(0x3fff, reader, function(eof, i, bi, time, flags, plen, p, pp, success) {
    if (eof === true) {
      console.log('...done');
      document.body.removeChild(loading);

      build_ui(packets, packets_succ, packets_fail,
               transactions, transactions_succ, transactions_fail,
               transfers, transfers_succ, transfers_fail);
      return;
    }

    if (bi === 0) {
      loading.innerText = 'loading... ' + ((reader.estimate_percentage() * 100) | 0) + '%';
    }

    var packet_id = i << 1 | (success === true ? 1 : 0);

    var packet = {
      id: packet_id,
      f: flags,
      t: time,
      p: p, plen: plen};
    packets.push(packet);
    (success === true ? packets_succ : packets_fail).push(packet);

    if (success) transaction_machine.process_packet(pp, packet);
  });
}

function build_file_drop_area() {
  var div = ce('div',
    {height: '100%', width: '100%',
     backgroundColor: 'purple', color: 'white', fontSize: '8em'});
  div.innerText = "Drop a packet file";


  div.addEventListener("dragover", stopprop);
  div.addEventListener("dragenter", function(e) {
    div.style.backgroundColor = 'cyan';
    return stopprop(e);
  });
  div.addEventListener("dragleave", function(e) {
    div.style.backgroundColor = 'purple';
    return stopprop(e);
  });
  div.addEventListener("drop", function(e) {
    var dt = e.dataTransfer;
    if (dt === undefined) alert("no data transfer");
    var files = dt.files;
    for (var i = 0, il = files.length; i < il; ++i) {
      var file = files[i];
      var reader = new FileReader();
      reader.onload = function(pe) {
        if (pe.total !== pe.loaded) throw "xx";
        var ab = reader.result;
        process_and_init(new Uint8Array(ab));
        document.body.removeChild(div);
      };
      reader.readAsArrayBuffer(file);
      break;
    }
    return stopprop(e);
  });
  document.body.appendChild(div);
}

// This is a bit hairy because the sender (host or device) must be reconstructed
// from context, the information doesn't exist for which side the packet came from.
var last_was_host = false;
var next_is_dev = false;
function decoded_packet_to_utg_entry(pp) {
  switch (pp.pid_type) {
    case 0:  // Special
      last_was_host = true;
      switch (pp.pid_name) {
        case 2:
          return "pid=SPLIT { sc=" + pp.SC + " hub_addr=" + pp.HubAddr +
                 " port=" + pp.Port + " s=" + pp.S + " e=" + pp.EU + " et=" + pp.ET + " }\n";
          break;
        default:
          return "; error handling special\n";
      }
      break;

    // Token packets:
    //   Sync PID ADDR ENDP CRC5 EOP
    // Start of Frame Packets:
    //   Sync PID Frame Number CRC5 EOP
    case 1:
      last_was_host = true;
      next_is_dev = pp.pid_name === 2;
      return "pid=" + kPidNameTable[pp.pid_name + 4] + " addr=" + pp.ADDR +
             " endp=" + pp.EndPoint + " { }\n";

    // Handshake packets:
    //   Sync PID EOP
    case 2:
      return (last_was_host ? "expected_pid=" : "pid=") +
             kPidNameTable[pp.pid_name + 8] + " { }\n";

    // Data packets:
    //   Sync PID Data CRC16 EOP
    case 3:
      var str = next_is_dev ? "expected_pid=" : "pid=";
      str += kPidNameTable[pp.pid_name + 12] + " { data=(";
      for (var i = 0, il = pp.data.length; i < il; ++i) {
        var hex = pp.data[i].toString(16);
        if (hex.length < 2) hex = "0" + hex;
        str += " " + hex;
      }
      str += " ) }\n";
      last_was_host = !next_is_dev;
      return str;
  }

  return '; error\n';
}

function export_as_utg(reader) {
  reader.reset();

  var rawdata = reader.rawdata;

  var last_t = 0;
  var t_base = 0;

  var strs = [
    "file_type=UPAS \n" +
    "file_version=4\n" +
    "file_mode=HOST   ; Emulates a HOST or DEVICE\n" +
    "file_speed=HIGH\n"
  ];

  block_decode_packets(0x3fff, reader, function(eof, i, bi, t, flags, plen, p, pp, success) {
    if (eof === true) {
      var blob = new Blob(strs, {type: "text/plain;charset=utf-8"});
      saveAs(blob, "export.utg");
      return;
    }

    if (success === true) {  // what to do on failure?
      if (pp.pid_type !== 1 || pp.pid_name !== 1) {  // Ignore SOF
        var str = decoded_packet_to_utg_entry(pp);
        strs.push(str);
      }
    }
  });
}

function export_as_pkt(reader) {
  reader.reset();

  var rawdata = reader.rawdata;

  var last_t = 0;
  var t_base = 0;

  var strs = [ ];

  block_decode_packets(0x3fff, reader, function(eof, i, bi, t, flags, plen, p, pp, success) {
    if (eof === true) {
      var blob = new Blob(strs, {type: "text/plain;charset=utf-8"});
      saveAs(blob, "export.pkt");
      return;
    }

    if (t < last_t) t_base += 0x1000000;  // 24 bit counter @60MHz rollover
    last_t = t;

    t = (t + t_base) / 60e6;  // 60MHz -> seconds.

    var str = 'RawPacket data<';

    for (var j = 0; j < plen; ++j) {
      var hex = rawdata[p + j].toString(16);
      if (hex.length < 2) hex = "0" + hex;
      str += (j !== 0 ? " " : "") + hex;
    }

    str += '> speed<HS> time<' + t + '>\n';

    strs.push(str);
  });
}

window.onload = function() {
  if (rawpcapdata !== null) {
    process_and_init(rawpcapdata);
  } else {
    build_file_drop_area();
  }
};
