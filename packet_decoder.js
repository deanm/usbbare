var structs = require('./structs.js');
var crclib  = require('./crc.js');

function decode_packet(packet) {
  var plen = packet.length;

  // This pid is repeated as the binary complement.
  var pid = packet[0] & 0xf, npid = (~packet[0] >> 4) & 0xf;

  if (pid !== npid) throw 'pid and npid mismatch.';

  // Token packets:
  //   Sync PID ADDR ENDP CRC5 EOP
  // Start of Frame Packets:
  //   Sync PID Frame Number CRC5 EOP
  // Data packets:
  //   Sync PID Data CRC16 EOP
  // Handshake packets:
  //   Sync PID EOP

  var fields = [ ];
  var pid_type = pid & 0x3;
  var pid_name = pid >> 2;

  var res = {
    pid_type: pid_type,
    pid_name: pid_name,
    error: null};

  switch (pid_type) {
    case 0:  // Special
      res.pid_type_str = "Special";
      break;

    case 1:  // Token
      if (plen != 3) throw "token packet length != 3";

      res.pid_type_str = "Token";
      res.pid_name_str = ["OUT", "SOF", "IN", "SETUP"][pid_name];
      var parser = (pid >> 2 === 1) ? structs.parse_StartOfFramePacket : structs.parse_TokenPacket;
      parser(fields, packet, 1, packet.length);

      var crc = crclib.crc5_16bit(packet[1], packet[2]);
      if (crc !== 6) res.error = "BADCRC5: 0x" + crc.toString(16);
      break;

    case 2:  // Handshake
      res.pid_type_str = "Handshake";
      res.pid_name_str = ["ACK", "NYET", "NAK", "STALL"][pid >> 2];
      break;

    case 3:  // Data
      res.pid_type_str = "Data";
      res.pid_name_str = ["DATA0", "DATA2", "DATA1", "MDATA"][pid >> 2];
      var crc = crclib.crc16(packet, 1);
      if (crc !== 0xb001) res.error = "BADCRC16: 0x" + crc.toString(16);
      break;
  }

  for (var i = 0, il = fields.length; i < il; i += 3) {
    res[fields[i]] = fields[i+1];
  }

  return res;
}

try {
  exports.decode_packet = decode_packet;
} catch(e) { }
