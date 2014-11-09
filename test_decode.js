var structs = require('./structs.js');
var decoder = require('./packet_decoder.js');

var next_data_is_setup = false;
function process_packet(packet) {

  var fields = [ ];
  var res = decoder.decode_packet(packet);

  // if (res.error !== null)  ...

  if (res.pid_type === 1 && res.pid_name === 3) next_data_is_setup = true;

  if (res.pid_type === 3 && next_data_is_setup === true) {
    structs.parse_setup(fields, packet, 1, packet.length-2);
    next_data_is_setup = false;
  }

  console.log(res);
  for (var i = 0, il = fields.length; i < il; i += 3) {
    var ftext = '  ' + fields[i] + ': 0x' + fields[i+1].toString(16);
    if (fields[i+2] !== null) ftext += ' (' + fields[i+2] + ')';
    console.log(ftext);
  }
}

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
  forAsyncEachLine(f, function(line) {
    var ind = line.indexOf('data=');
    var packet = [ ];
    for (i = ind + 5, il = line.length; i < il; i += 3) {
      packet.push(parseInt(line.substr(i, 3), 16));
    }
    if (packet.length !== 0) process_packet(packet);
  }, function() { });
}

if (process.argv.length > 2) {
  process_file(process.argv[2]);
} else {
  console.log("usage: <filename>");
}
