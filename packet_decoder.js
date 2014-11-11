var structs = require('./structs.js');
var crclib  = require('./crc.js');

function decode_packet(packet) {
  var plen = packet.length;
  if (plen < 1) return {error: 'empty packet'};

  // This pid is repeated as the binary complement.
  var pid = packet[0] & 0xf, npid = (~packet[0] >> 4) & 0xf;

  var pid_type = pid & 0x3, pid_name = pid >> 2;

  var res = {
    pid_type: pid_type,
    pid_name: pid_name,
    data:     null,
    error:    null};

  if (pid !== npid) {
    res.error = 'pid and npid mismatch.';
    return res;
  }

  switch (pid_type) {
    case 0:
      break;

    // Token packets:
    //   Sync PID ADDR ENDP CRC5 EOP
    // Start of Frame Packets:
    //   Sync PID Frame Number CRC5 EOP
    case 1:
      if (plen != 3) { res.error = "token packet length != 3"; return res; }
      var r = packet[1] | packet[2] << 8;
      if (pid >> 2 === 1) {  // SOF
        res.FrameNumber = r & 0x7ff;
      } else {
        res.ADDR = r & 0x7f;
        res.EndPoint = (r >> 7) & 0xf;
      }
      res.CRC5 = (res >> 11) & 0x1f;
      break;

    // Handshake packets:
    //   Sync PID EOP
    case 2:
      if (plen != 1) { res.error = "handshake packet length != 3"; return res; }
      break;

    // Data packets:
    //   Sync PID Data CRC16 EOP
    case 3:
      res.data = packet.slice(1, packet.length-2);
      break;
  }

  return res;
}

function decode_packet_to_display_string(packet) {
  var plen = packet.length;
  if (plen < 1) return "ERROR: empty packet";

  // This pid is repeated as the binary complement.
  var pid = packet[0] & 0xf, npid = (~packet[0] >> 4) & 0xf;

  var pid_type = pid & 0x3, pid_name = pid >> 2;

  if (pid !== npid) return 'ERROR: pid != npid';

  var text = "";
  switch (pid_type) {
    case 0:
      text = "special";
      break;

    // Token packets:
    //   Sync PID ADDR ENDP CRC5 EOP
    // Start of Frame Packets:
    //   Sync PID Frame Number CRC5 EOP
    case 1:
      if (plen != 3) return "ERROR: token packet length != 3";
      text = "token " + ["OUT", "SOF", "IN", "SETUP"][pid_name];
      var fields = new structs.Fields();
      var parser = (pid >> 2 === 1) ? structs.parse_StartOfFramePacket : structs.parse_TokenPacket;
      parser(fields, packet, 1, packet.length);
      var crc = crclib.crc5_16bit(packet[1], packet[2]);
      if (crc !== 6) text += " ERROR: bad crc5: 0x" + crc.toString(16);
      break;

    // Handshake packets:
    //   Sync PID EOP
    case 2:
      if (plen != 1) return "ERROR: handshake packet length != 1";
      text = "handshake " + ["ACK", "NYET", "NAK", "STALL"][pid >> 2];
      break;

    // Data packets:
    //   Sync PID Data CRC16 EOP
    case 3:
      if (plen < 3) return "ERROR: data packet length < 3";
      text = "data " + ["DATA0", "DATA2", "DATA1", "MDATA"][pid >> 2] + " len " + (packet.length-3);
      var crc = crclib.crc16(packet, 1);
      if (crc !== 0xb001) res.error = "ERROR: bad crc16: 0x" + crc.toString(16);
      break;
  }

  return text;
}

try {
  exports.decode_packet = decode_packet;
  exports.decode_packet_to_display_string = decode_packet_to_display_string;
} catch(e) { }
