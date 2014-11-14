var structs = require('./structs.js');
var usb_states = require('./usb_states.js');

function TransactionMachine() {
  var this_ = this;

  this.OnEmit = null;

  var states = [ ];

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
        packets: [ ],
        transtype: transtype,
        typename: typename});
    },
  };

  cb.spawn("setup_run", "transaction", "SetupTransaction", null);
  cb.spawn("bulkin_run", "transaction", "BulkTransactionIn", null);
  cb.spawn("bulkout_run", "transaction", "BulkTransactionOut", null);

  this.process_packet = function(pp, packet) {
    if (pp.pid_type === 1 && pp.pid_name === 1) return null;  // Ignore SOF

    // cache states length because we don't want to process newly spawned
    // states until the next packet.
    if (states.length > 100) console.log("Warning: num states: " + states.length);
    for (var i = 0, il = states.length; i < il; ++i) {
      var state = states[i];
      state.packets.push(packet);
      var meta = {packet: packet};
      var res = state.s(pp, state.out, meta, state, cb);
      //console.log(res);

      if (res.next === usb_states.kPass) {
        state.packets.pop();  // hack...
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

function TransferMachine() {
  var this_ = this;

  this.OnEmit = null;

  var states = [ ];

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
        transactions: [ ],
        transtype: transtype,
        typename: typename});
    },
  };

  cb.spawn("ct_run", "transfer", "ControlTransfer", null);

  this.process_transaction = function(tr, transaction) {
    if (tr.success !== true) throw "Shouldn't process failed transactions.";

    // cache states length because we don't want to process newly spawned
    // states until the next packet.
    if (states.length > 100) console.log("Warning: num states: " + states.length);
    for (var i = 0, il = states.length; i < il; ++i) {
      var state = states[i];
      state.transactions.push(transaction);
      var meta = {transaction: transaction};
      var res = state.s(tr, state.out, meta, state, cb);

      if (res.next === usb_states.kPass) {
        state.transactions.pop();  // hack...
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
  exports.TransferMachine = TransferMachine;
} catch(e) { }
