var fs = require('fs');
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
