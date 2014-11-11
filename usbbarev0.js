var decoder = require('./packet_decoder.js');

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

function build_text_div(str) {
  var div = document.createElement('div');
  div.innerText = str;
  return div;
}

var kPidNameTable =  [
  "", "", "", "",
  "OUT", "SOF", "IN", "SETUP",
  "ACK", "NYET", "NAK", "STALL",
  "DATA0", "DATA2", "DATA1", "MDATA"
];

function build_packet_display(n, p) {
  while (n.firstChild) n.removeChild(n.firstChild);

  var d = decoder.decode_packet(p.d);
  if (d.error !== null) {
    n.innerText = 'ERROR: ' + d.error;
    return;
  }

  //n.appendChild(build_text_div(JSON.stringify(d)));
  var pid_type_str = ["special", "token", "handshake", "data"][d.pid_type];
  var pid_name_str = kPidNameTable[d.pid_type << 2 | d.pid_name];

  n.appendChild(make_field("PID", 4,
    [make_bit_field_node("pid_type", d.pid_type + " (" + pid_type_str + ")", to_bin_str(2, d.pid_type)),
     make_bit_field_node("pid_name", d.pid_name + " (" + pid_name_str + ")", to_bin_str(2, d.pid_name))]));

  if (d.pid_type === 1) {  // Token
    if (d.pid_name === 1) {  // SOF
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

function build_packet_line(i) {
  var p = packets[i];
  var line = document.createElement('div');
  line.style.height = kCellHeight + 'px';
  var n = document.createElement('span');
  var ts = document.createElement('span');
  var f = document.createElement('span');
  var desc = document.createElement('span');
  n.innerText = i; ts.innerText = p.t;
  f.innerText = p.f; desc.innerText = decoder.decode_packet_to_display_string(p.d);
  line.appendChild(n); line.appendChild(ts);
  line.appendChild(f); line.appendChild(desc);
  line.packet_num = i;
  return line;
}

var kCellHeight = 18;
function build_packet_list_display(packets) {
  var num_packets = packets.length;

  var total_height = packets.length * kCellHeight;

  var hole0 = document.createElement('div');
  hole0.style.backgroundColor = 'blue';
  hole0.style.height = 0;

  var hole1 = document.createElement('div');
  hole1.style.backgroundColor = 'red';
  hole1.style.height = total_height + 'px';

  var packet_display_node = document.createElement('div');
  packet_display_node.className = "usbbare-p";

  var div = document.createElement('div');
  div.className = "usbbare-pd";

  var a = 0;
  var b = 0;

  var selected = null;

  function empty_layout() {
    while (b > a) {  // removing elements from the bottom
      --b;
      div.removeChild(hole1.previousSibling);
      if (b === selected) div.removeChild(hole1.previousSibling);
    }
  }

  function layout() {
    var body = document.body;
    var stop = body.scrollTop - div.offsetTop;

    var c = stop / kCellHeight | 0;
    var d = (stop + body.clientHeight + kCellHeight) / kCellHeight | 0;
    if (c < 0) c = 0;
    if (d > num_packets) d = num_packets;
    if (d < c) d = c;

    while (a < c && a < b) {  // removing elements from the top
      div.removeChild(hole0.nextSibling);
      if (a === selected) div.removeChild(hole0.nextSibling);
      ++a;
    }

    while (b > d && b > a) {  // removing elements from the bottom
      --b;
      div.removeChild(hole1.previousSibling);
      if (b === selected) div.removeChild(hole1.previousSibling);
    }

    if (a === b) a = b = c;

    while (a > c) {  // adding elements to the top
      a--;
      if (a === selected) div.insertBefore(packet_display_node, hole0.nextSibling);
      div.insertBefore(build_packet_line(a), hole0.nextSibling);
    }

    while (b < d && b < num_packets) {  // adding elements to the bottom
      div.insertBefore(build_packet_line(b), hole1);
      if (b === selected) div.insertBefore(packet_display_node, hole1);
      ++b;
    }

    var hole0_height = a * kCellHeight;
    var hole1_height = total_height - ((b - a) * kCellHeight) - hole0_height;
    hole0.style.height = hole0_height + 'px';
    hole1.style.height = hole1_height + 'px';
  }

  document.addEventListener("scroll", function(x) { layout(); });
  window.addEventListener("resize", function(x) { layout(); });
  
  var selected = null;

  div.addEventListener('click', (function() { return function(e) {
    console.log(e);
    for (var target = e.target; target !== div; target = target.parentNode) {
      if (target.packet_num !== undefined) {
        empty_layout();
        build_packet_display(packet_display_node, packets[target.packet_num]);
        selected = target.packet_num;
        layout();
        break;
      }
    }
  };})());

  div.appendChild(hole0);
  div.appendChild(hole1);

  layout();
  //layout_cd(47, 87);
  //layout_cd(0, 39)
  //layout_cd(0, 28)
  //layout_cd(0, 17);

  return div;
}

window.onload = function() {
  document.body.appendChild(build_packet_list_display(packets));
};
