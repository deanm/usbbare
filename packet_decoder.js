var crclib  = require('./crc.js');

function decode_packet(packet) {
  var plen = packet.length;
  if (plen < 1) return {error: 'empty packet'};

  // This pid is repeated as the binary complement.
  var pid = packet[0] & 0xf, npid = (~packet[0] >> 4) & 0xf;

  if (pid !== npid) return {error: 'pid and npid mismatch.'};

  var pid_type = pid & 0x3, pid_name = pid >> 2;

  var res = {
    pid_type: pid_type,
    pid_name: pid_name,
    data:     null,
    error:    null};

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
      if (pid_name === 1) {  // SOF
        res.FrameNumber = r & 0x7ff;
      } else {
        res.ADDR = r & 0x7f;
        res.EndPoint = (r >> 7) & 0xf;
      }
      res.CRC5 = (r >> 11) & 0x1f;
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
      res.CRC16 = packet[plen-1] << 8 | packet[plen-2];
      break;
  }

  return res;
}

function decode_packet_to_display_string(packet) {
  var plen = packet.length;

  var dp = decode_packet(packet);
  if (dp.error !== null) return dp.error;

  var pid_type = dp.pid_type, pid_name = dp.pid_name;

  var text = null;
  switch (pid_type) {
    case 0:
      text = "special " + ["RESERVED", "PING", "SPLIT", "PRE/ERR"][pid_name];
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
      var crc = crclib.crc5_16bit(packet[1], packet[2]);
      if (crc !== 6) text += " ERROR: bad crc5: 0x" + crc.toString(16);
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
      text = "data " + ["DATA0", "DATA2", "DATA1", "MDATA"][pid_name] + " len " + (packet.length-3);
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
