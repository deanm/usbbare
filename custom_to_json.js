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

function process_file(filename, done) {
  var fs = require('fs');
  var f = fs.createReadStream(filename, {encoding: 'utf8'});

  forAsyncEachLine(f, function(line) {
    var ind = line.indexOf('ts=');
    var t = parseInt(line.substr(ind+3));
    ind = line.indexOf('flags=');
    var f = parseInt(line.substr(ind+6));
    ind = line.indexOf('data=');
    var data = [ ];
    for (i = ind + 5, il = line.length; i < il; i += 3) {
      data.push(parseInt(line.substr(i, 3), 16));
    }
    out.push({t: t, f: f, d: data});
  }, done);
}

if (process.argv.length > 2) {
  process_file(process.argv[2], function() {
    console.log("packets = " + JSON.stringify(out) + ";");
  });
} else {
  console.log("usage: <filename>");
}
