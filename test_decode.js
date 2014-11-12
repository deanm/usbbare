var fs = require('fs');
var structs = require('./structs.js');
var usb_machine = require('./usb_machine.js');

if (process.argv.length > 2) {
  eval(fs.readFileSync(process.argv[2], 'utf8'));
} else {
  console.log("usage: <filename.js>");
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

var transaction_machine = new usb_machine.TransactionMachine();

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

transaction_machine.OnEmit = function(typename, success, out, state) {
  //console.log(["emit", typename, out, state.id]);
  console.log(["emit", typename, success, state.id]);
};

//var decoder = require('./packet_decoder.js');
for (var i = 0, il = packets.length; i < il; ++i) {
  var packet = packets[i];
  //console.log(decoder.decode_packet_to_display_string(packet.d));
  if (packet.d.length !== 0)
    transaction_machine.process_packet(packet.d, i);
}
