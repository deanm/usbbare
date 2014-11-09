var structs = require('./structs.js');
var transfer_machine = require('./transfer_machine.js');

function forAsyncEachLine(stream, line_callback, eof_callback) {
  var leftovers = '';

  stream.on('data', function(data) {
    var prev = 0;
    for (var i = 0, il = data.length; i < il; ++i) {
      if (data[i] === '\n') {
        if (i === prev && leftovers.length === 0) {
          ++prev;
        } else {
          line_callback(leftovers + data.substr(prev, i-prev));
          leftovers = '';
          prev = i + 1;
        }
      }
    }
    if (prev !== i) leftovers = data.substr(prev, i-prev);
  });

  stream.on('close', function() {
    if (leftovers.length !== 0) {
      // console.log('No trailing newline...');
      line_callback(leftovers);
    }
    eof_callback();
  });
}

function process_file(filename) {
  var fs = require('fs');
  var f = fs.createReadStream(filename, {encoding: 'utf8'});
  var machine = new transfer_machine.TransferMachine();

  machine.OnControlTransfer = function(addr, endp, setup, data) {
    console.log(['Control Transfer', addr, endp, setup]);
  };

  forAsyncEachLine(f, function(line) {
    var ind = line.indexOf('data=');
    var packet = [ ];
    for (i = ind + 5, il = line.length; i < il; i += 3) {
      packet.push(parseInt(line.substr(i, 3), 16));
    }
    if (packet.length !== 0) machine.process_packet(packet);
  }, function() { });
}

if (process.argv.length > 2) {
  process_file(process.argv[2]);
} else {
  console.log("usage: <filename>");
}
