var fs = require('fs');
var structs = require('./structs.js');
var transfer_machine = require('./transfer_machine.js');

function roll_up_js(filename) {
  var src = fs.readFileSync(__dirname + '/' + filename, 'utf8');
  return src.replace(/require\('(.*?)'\);/g, function(match, p1) {
    return '(function(exports) {' + roll_up_js(p1) + ' return exports;})({});';
  });
}

if (process.argv.length > 2) {
  //eval(fs.readFileSync(process.argv[2], 'utf8'));
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

var machine = new transfer_machine.TransferMachine();

machine.OnControlTransfer = function(addr, endp, setup, data) {
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
};

var decoder = require('./packet_decoder.js');
console.log('<html><head><style>' + fs.readFileSync(__dirname + '/usbbarev0.css', 'utf8'));
console.log('</style><script>');
console.log(fs.readFileSync(process.argv[2], 'utf8'));
console.log('</script><script>' + roll_up_js('/usbbarev0.js'));
console.log('</script><body></body></html>');