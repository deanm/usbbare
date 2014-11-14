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

var out = [ ];

var stdout = process.stdout;

function process_file(filename, done) {
  var fs = require('fs');
  var f = fs.createReadStream(filename, {encoding: 'utf8'});

  forAsyncEachLine(f, function(line) {
    var ind = line.indexOf('ts=');
    var t = parseInt(line.substr(ind+3));
    ind = line.indexOf('flags=');
    var f = parseInt(line.substr(ind+6));
    ind = line.indexOf('data=');

    var data = [
      f & 0xff, (f >> 8) & 0xff,
      t & 0xff, (t >> 8) & 0xff, (t >> 16) & 0xff,
      0, 0
      ];
    for (i = ind + 5, il = line.length; i < il; i += 3) {
      data.push(parseInt(line.substr(i, 3), 16));
    }

    var plen = data.length - 7;
    data[5] = plen & 0xff;
    data[6] = (plen >> 8) & 0xff;
    data.push('');  // to get the ending comma
    stdout.write(data.join(','), 'utf8');
  }, done);
}

if (process.argv.length > 2) {
  stdout.write("rawpcapdata = new Uint8Array([", "utf8");
  process_file(process.argv[2], function() {
    stdout.write("]);");
  });
} else {
  console.log("usage: <filename>");
}
