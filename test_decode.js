var structs = require('./structs.js');
var crclib  = require('./crc.js');

function pid_to_group_name(pid) {
  return ["special", "token", "handshake", "data"][pid & 3];
}

var next_is_setup = false;
function process_packet(packet) {
  var plen = packet.length;

  // This pid is repeated as the binary complement.
  var pid = packet[0] & 0xf, npid = (~packet[0] >> 4) & 0xf;

  if (pid !== npid)
    console.log('Warning, pid and npid mismatch.');

  //console.log([pid, npid]);
  //console.log(pid_to_group_name(pid));

  var group = pid & 0x3;

  // Token packets:
  //   Sync PID ADDR ENDP CRC5 EOP
  // Start of Frame Packets:
  //   Sync PID Frame Number CRC5 EOP
  // Data packets:
  //   Sync PID Data CRC16 EOP
  // Handshake packets:
  //   Sync PID EOP

  var text = "";

  var fields = [ ];

  switch (group) {
    case 0:  // Special
      text += "special";
      break;

    case 1:  // Token
      if (plen != 3) throw "token packet length != 3";
      var type = ["OUT", "SOF", "IN", "SETUP"][pid >> 2];
      text += "token " + type;

      var parser = (pid >> 2 === 1) ? structs.parse_StartOfFramePacket : structs.parse_TokenPacket;
      parser(fields, packet, 1, packet.length);

      var crc = crclib.crc5_16bit(packet[1], packet[2]);
      if (crc !== 6) text += " BADCRC5: 0x" + crc.toString(16);
      if (pid >> 2 === 3) next_is_setup = true;
      break;

    case 2:  // Handshake
      text += "handshake " + ["ACK", "NYET", "NAK", "STALL"][pid >> 2];
      break;

    case 3:  // Data
      text += "data " + ["DATA0", "DATA2", "DATA1", "MDATA"][pid >> 2];
      var crc = crclib.crc16(packet, 1);
      if (crc !== 0xb001) text += " BADCRC16: 0x" + crc.toString(16);
      if (next_is_setup === true) {
        structs.parse_setup(fields, packet, 1, packet.length-2);
        next_is_setup = false;
      }
      break;
  }

  if (text.length !== 0) console.log(text);
  for (var i = 0, il = fields.length; i < il; i += 3) {
    var ftext = '  ' + fields[i] + ': 0x' + fields[i+1].toString(16);
    if (fields[i+2] !== null) ftext += ' (' + fields[i+2] + ')';
    console.log(ftext);
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
