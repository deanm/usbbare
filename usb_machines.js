var usb_states = require('./usb_states.js');

function Device(first_transfer_id) {
  this.first = first_transfer_id;
  this.addr = 0;
  this.max_packet_size = -1;
  this.strings = [ ];

  // States:
  //   - Attached / Powered (hardware level)
  //   - Default
  //   - Address
  //   - Configured
  this.state = "default";
  this.configuration = -1;
}

function flatten_chunked(data) {
  var total_len = 0;
  for (var i = 0, il = data.length; i < il; i += 2) total_len += data[i].length;
  var flat = new Uint8Array(total_len);
  var p = 0;
  for (var i = 0, il = data.length; i < il; i += 2) {
    flat.set(data[i], p);
    p += data[i].length;
  }
  return flat;
}

function DeviceTracker() {

  var devices = [ ];
  var device_lookup = [ ];  // Will use as a dictionary with numeric keys.

  this.process_transfer = function(tr) {
    var device = undefined;
    var out = tr.out;

    device = device_lookup[out.ADDR];

    if (device === undefined && out.ADDR === 0) {
      device = new Device(tr.id >> 1);
      devices.push(device);
      device_lookup[0] = device;
    }

    if (device === undefined) throw "device";

    var setup = out.setup;
    if (!setup) throw "setup";

    // TODO: figure out how to do this cleaner than putting it all back together.
    var requesttype_and_request =
      setup.get_value_at(0) << 8 | setup.get_value_at(1) << 13 | setup.get_value_at(2) << 15 |
      setup.get_value_at(3);

    switch (requesttype_and_request) {
      case 0x0005:  // SET_ADDRESS
        if (device.state !== "default") throw device.state;
        if (out.ADDR !== 0) throw "SET_ADDRESS when not 0.";
        device.addr = setup.get_value("wValue");
        if (device.addr in devices) throw "device already exists.";
        device.state = "address";
        delete device_lookup[out.ADDR];
        device_lookup[device.addr] = device;
        break;

      case 0x0009:  // SET_CONFIGURATION
        // TODO: Support deconfigurtation?
        if (device.state !== "address") throw device.state;
        device.configuration = setup.get_value("wValue");
        device.state = "configured";
        break;

      case 0x8006:  // GET_DESCRIPTOR
        var wvalue = setup.get_value("wValue");
        var desctype = wvalue >> 8, descidx = wvalue & 0xff;

        var data = out.data;
        if (data === undefined || data.length === 0) throw "xx";
        var flat_data = flatten_chunked(data);

        // 5.5.3 Control Transfer Packet Size Constraints
        //   An endpoint for control transfers specifies the maximum data
        //   payload size that the endpoint can accept from or transmit to the
        //   bus. The allowable maximum control transfer data payload sizes for
        //   full-speed devices is 8, 16, 32, or 64 bytes; for high-speed
        //   devices, it is 64 bytes and for low-speed devices, it is 8 bytes.
        //   ...
        //   A Setup packet is always eight bytes. A control pipe (including
        //   the Default Control Pipe) always uses its wMaxPacketSize value for
        //   data payloads.
        if (desctype === 1 /* DEVICE */) {
          if (descidx !== 0) throw "xx";

          // Even for low speed we should get at least the first 8 bytes.
          // And of course bMaxPacketSize0 fits as the last of those.
          if (flat_data.length < 8) throw flat_data.length + " < 8";

          var max_size = flat_data[7];

          if (device.max_packet_size === -1)
            device.max_packet_size = max_size;

          if (device.max_packet_size !== max_size) throw "xx";
        }

        if (desctype === 3 /* STRING */) {
          if (descidx === 0) break;  // Ignore language

          var ustr_len = flat_data[0] - 2;
          var ustr = '';
          for (var i = 0; i*2+3 < flat_data.length && i < ustr_len; ++i) {
            ustr += String.fromCharCode(flat_data[i*2+2] | flat_data[i*2+3] << 8);
          }

          if (device.strings[descidx] === undefined ||
              device.strings[descidx].length < ustr.length) {
            device.strings[descidx] = ustr;
          }
        }

        break;
    }
  };

  this.devices = devices;
}

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
      name = "state_" + typename + "_" + statename + "0";
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
  cb.spawn("run", "transaction", "InterruptTransactionIn", null);

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
        //console.log(['die', state.transtype, state.typename]);
        states.splice(i, 1); --i; --il;
        continue;
      }

      state.s = res.next;

      if (res.do_break === true) break;
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
      name = "state_" + typename + "_" + statename + "0";
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
  exports.DeviceTracker = DeviceTracker;
} catch(e) { }
