var fs = require('fs');
var structs = require('./structs.js');
var decoder = require('./packet_decoder.js');
var usb_machines = require('./usb_machines.js');

var rawpcapdata = null;

// Compatability between node Buffer and TypedArray.
Buffer.prototype.subarray = function(a, b) {
  return this.slice(a, b);
};

if (process.argv.length > 2) {
  rawpcapdata = fs.readFileSync(process.argv[2]);
} else {
  console.log("usage: <filename.pcap>");
  process.exit(1);
}

function octets_to_hex_string(octets) {
  return octets.map(function(x) {
    var str = x.toString(16);
    return str.length === 1 ? "0" + str : str;
  }).join(' ');
}

function flatten(arr) {
  return arr.length === 0 ? arr : arr.reduce(function(a, b) { return a.concat(b); });
}

var transaction_machine = new usb_machines.TransactionMachine();

var transfer_machine = new usb_machines.TransferMachine();

/*
function OnControlTransfer(addr, endp, setup, data) {
  console.log("Control transfer: addr: " + addr + " endpoint: " + endp);
  var bRequest = setup.get_value("bRequest");
  console.log(setup.debug_string("  "));
  data = flatten(data);
  if (data.length > 0) console.log('    Data: ' + octets_to_hex_string(data));

  switch (bRequest) {
    case 6: // GET_DESCRIPTOR
      var wvalue = setup.get_value("wValue");
      var desctype = wvalue >> 8, descidx = wvalue & 0xff;
      console.log(structs.eDescriptorTypes[desctype]);
      var descriptor = new structs.Fields();
      console.log(data.length);
      if (structs.parse_StandardConfigurationDescriptor(descriptor, data, 0, data.length))
        console.log(descriptor.debug_string("    "));
      break;
    default:
      console.log("Unknown bRequest: " + bRequest);
      break;
  }
}
*/

var transaction_id = 0;

transaction_machine.OnEmit = function(transtype, typename, success, out, state) {
  console.log(["emit", transtype, typename, success, transaction_id]);
  if (success === true) {
    var tr = {id: transaction_id,
              typename: typename,
              success: success,
              out: out};
    //transfer_machine.process_transaction(tr, tr.id);
  }
  ++transaction_id;
};

var transfer_id = 0;

transfer_machine.OnEmit = function(transtype, typename, success, out, state) {
  console.log(["emit", transtype, typename, success, transfer_id]);
  ++transfer_id;
};

var packets = [ ];

for (var i = 0, p = 0, l = rawpcapdata.length; p < l; ++i) {
  var plen = rawpcapdata[p + 5] | rawpcapdata[p + 6] << 8;
  var pp = plen === 0 ? null : decoder.decode_packet(rawpcapdata, p+7, plen);
  packets.push({
    f: rawpcapdata[p] | rawpcapdata[p+1] << 8,
    t: rawpcapdata[p+2] | rawpcapdata[p+3] << 8 | rawpcapdata[p+4] << 8,
    plen: plen, pp: pp});

  if (pp === null) {
    console.log('packet error:');
    console.log(plen);
    console.log(rawpcapdata.subarray(p+7, p+7+plen));
  } else {
    transaction_machine.process_packet(pp, i);
  }

  p += 7 + plen;
}
