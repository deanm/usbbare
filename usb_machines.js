var structs = require('./structs.js');
var decoder = require('./packet_decoder.js');
var usb_states = require('./usb_states.js');

function TransactionMachine() {
  var this_ = this;

  this.OnEmit = null;

  var states = [ ];
  var next_id = 0;

  var cb = {
    emit: function(transtype, typename, success, out, state) {
      if (this_.OnEmit !== null) this_.OnEmit(transtype, typename, success, out, state);
    },
    spawn: function(statename, transtype, typename, state) {
      //console.log(['spawn', statename, transtype, typename]);
      name = "state_" + typename + "_" + statename;
      if (!(name in usb_states)) throw name;
      states.push({
        out: new usb_states[typename],
        s: usb_states[name](),
        ids: [ ],
        id: next_id,
        transtype: transtype,
        typename: typename});
      ++next_id;
    },
  };

  cb.spawn("setup_run", "transaction", "SetupTransaction", null);
  cb.spawn("bulkin_run", "transaction", "BulkTransactionIn", null);
  cb.spawn("bulkout_run", "transaction", "BulkTransactionOut", null);

  this.process_packet = function(rp, id) {
    // rp: raw packet, pp: parsed packet
    var pp = decoder.decode_packet(rp);

    if (pp.error !== null) throw pp.error;

    if (pp.pid_type === 1 && pp.pid_name === 1) return null;  // Ignore SOF

    // cache states length because we don't want to process newly spawned
    // states until the next packet.
    if (states.length > 100) console.log("Warning: num states: " + states.length);
    for (var i = 0, il = states.length; i < il; ++i) {
      var state = states[i];
      state.ids.push(id);
      var meta = {id: id};
      var res = state.s(pp, state.out, meta, state, cb);
      //console.log(res);

      if (res.next === usb_states.kPass) {
        state.ids.pop();  // hack...
        continue;
      }

      if (res.next === usb_states.kEnd) {
        states.splice(i, 1); --i; --il;
        continue;
      }

      state.s = res.next;
    }
  };
}

try {
  exports.TransactionMachine = TransactionMachine;
} catch(e) { }
