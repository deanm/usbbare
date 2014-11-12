var structs = require('./structs.js');
var decoder = require('./packet_decoder.js');
var states = require('./transfer_states.js');

function TransferMachine() {
  var this_ = this;

  this.OnEmit = null;

  var cur_states = [ ];

  var cur_id = 0;

  var cb = {
    emit: function(name, state, args) {
      if (this_.OnEmit !== null)
        this_.OnEmit(name, state, args);

      var tr = {transaction_type: name};

          console.log(state.ids);
      switch (name) {
        case "ControlTransferIn":
        case "ControlTransferOut":
          console.log([name, JSON.stringify(args)]);
          return;
        case "SetupTransaction":
          tr.ADDR = args[0];
          tr.EndPoint = args[1];
          if (args[2] !== null) {
            tr[name] = args[2];
            args[2].put_on_object(tr);
          }
          break;
        case "BulkTransactionOut":
        case "BulkTransactionIn":
          tr.ADDR = args[0];
          tr.EndPoint = args[1];
          tr.data = args[2];
          break;
        default:
          console.log("Missing transaction: " + name);
          break;
      }

      this_.process_transaction(tr, state.id);
    },
    spawn: function(name, state, args) {
      name = "state_" + name + "_" + state.intype;
      if (!(name in states)) throw name;
      cur_states.push({
        s: states[name].apply(states, args),
        ids: [ ],
        id: cur_id,
        intype: state.intype});
      ++cur_id;
    },
    restart: function(name, state, args) {
      name = "state_" + name + "_" + state.intype;
      if (!(name in states)) throw name;
      state.s = states[name].apply(states, args);
      state.ids = [ ];
      state.id = cur_id;
      ++cur_id;
    }
  }

  // Start on the default control pipe
  cb.spawn("setup_transaction0", {intype: "packet"}, [0, 0]);
  cb.spawn("bulk_transaction_in0", {intype: "packet"}, [0, 0]);
  cb.spawn("bulk_transaction_out0", {intype: "packet"}, [0, 0]);
  cb.spawn("control_transfer_start", {intype: "transaction"}, [0, 0]);

  cb.spawn("setup_transaction0", {intype: "packet"}, [1, 0]);
  cb.spawn("bulk_transaction_in0", {intype: "packet"}, [1, 0]);
  cb.spawn("bulk_transaction_out0", {intype: "packet"}, [1, 0]);

  this.process_states = function(intype, rp, pp, id) {
    for (var i = 0; i < cur_states.length; ++i) {
      var state = cur_states[i];
      if (state.intype !== intype) continue;
      state.ids.push(id);
      var res = state.s(cb, state, rp, pp);

      if (res.next === states.kPass) {
        state.ids.pop();  // hack...
        continue;
      }

      if (res.next === states.kEnd) {
        cur_states.splice(i, 1); --i;
        continue;
      }

      state.s = res.next;
    }
  };

  this.process_packet = function(rp, id) {
    // rp: raw packet, pp: parsed packet
    var pp = decoder.decode_packet(rp);

    if (pp.error !== null) throw pp.error;

    if (pp.pid_type === 1 && pp.pid_name === 1) return null;  // Ignore SOF

    this.process_states("packet", rp, pp, id);
  };

  this.process_transaction = function(tr, id) {
    this.process_states("transaction", tr, tr, id);
  };
}

try {
  exports.TransferMachine = TransferMachine;
} catch(e) { }
