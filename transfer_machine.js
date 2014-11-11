var structs = require('./structs.js');
var decoder = require('./packet_decoder.js');
var states = require('./transfer_states.js');

function TransferMachine() {
  var this_ = this;

  function emit_ct(tid, addr, endp, setup, data) {
    if (this_.OnControlTransfer === null) return;
    this_.OnControlTransfer(tid, addr, endp, setup, data);
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
