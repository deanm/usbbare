function decode_packet(buf, p, plen) {
  if (plen < 1) return null;

  // This pid is repeated as the binary complement.
  var pid = buf[p] & 0xf, npid = (~buf[p] >> 4) & 0xf;

  if (pid !== npid) return null;

  var pid_type = pid & 0x3, pid_name = pid >> 2;

  var res = {
    pid_type: pid_type,
    pid_name: pid_name};

  switch (pid_type) {
    case 0:
      if (pid_name === 1) {  // PING, like a Token packet.
        if (plen != 3) return null;
        var r = buf[p+1] | buf[p+2] << 8;
        res.ADDR = r & 0x7f;
        res.EndPoint = (r >> 7) & 0xf;
        res.CRC5 = (r >> 11) & 0x1f;
      } else if (pid_name === 2) {
        if (plen != 4) return null;
        var r = buf[p+1] | buf[p+2] << 8 | buf[p+3] << 16;
        res.HubAddr = r & 0x7f;
        res.SC = (r >> 7) & 1;
        r >>= 8;
        res.Port = r & 0x7f;
        res.S = (r >> 7) & 1;
        res.U = (r >> 8) & 1;
        res.ET = (r >> 9) & 3;
        res.CRC5 = (r >> 10) & 0x1f;
      }
      break;

    // Token packets:
    //   Sync PID ADDR ENDP CRC5 EOP
    // Start of Frame Packets:
    //   Sync PID Frame Number CRC5 EOP
    case 1:
      if (plen != 3) return null;
      var r = buf[p+1] | buf[p+2] << 8;
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
      if (plen != 1) return null;
      break;

    // Data packets:
    //   Sync PID Data CRC16 EOP
    case 3:
      if (plen < 3) return null;
      res.data = buf.subarray(p+1, p+plen-2);
      res.CRC16 = buf[p+plen-1] << 8 | buf[p+plen-2];
      break;
  }

  return res;
}

try {
  exports.decode_packet = decode_packet;
} catch(e) { }
