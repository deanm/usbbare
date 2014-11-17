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

function cleanify_name(name, id) {
  name = name.replace(/[^a-zA-Z0-9]+/g, ' ');
  name = name.replace(/ +([^ ])/g, function(m, c) { return c.toUpperCase(); });
  name = name.trim();
  if (name.length === 0) name = "Unknown" + id;
  return name;
}

var fs = require('fs');

var classes = { }

var cur_class = null;
var cur_subclass = null;

function process_file(filename, done) {
  var f = fs.createReadStream(filename, {encoding: 'utf8'});

  forAsyncEachLine(f, function(line) {
    if (line.substr(0, 2) === "C ") {
      var class_id = parseInt(line.substr(2, 2), 16);
      var name = cleanify_name(line.substr(6), class_id);
      cur_class = {name: name, subclasses: { }, num_subclasses: 0};
      classes[class_id] = cur_class;
      return;
    }

    if (cur_class === null) return;

    if (line.substr(0, 2) === "\t\t") {
      var hex = parseInt(line.substr(2, 2), 16);
      var name = cleanify_name(line.substr(6));
      cur_subclass.interfaces[hex] = {name: name};
      ++cur_subclass.num_interfaces;
    } else if (line.substr(0, 1) === "\t") {
      var hex = parseInt(line.substr(1, 2), 16);
      var name = cleanify_name(line.substr(5), hex);
      cur_subclass = {name: name, interfaces: { }, num_interfaces: 0};
      cur_class.subclasses[hex] = cur_subclass
      ++cur_class.num_subclasses;
    } else {
      cur_class = null;
      return;
    }
  }, done);
}

function dump_enum2(classes, enum_name) {
  console.log("enum {");
  for (var key in classes) {
    var cls = classes[key];
    console.log("  " + cls.name + " = " + key + ";");
  }
  console.log("} " + enum_name + ";\n");
}

function dump_enum(classes) {
  dump_enum2(classes, "InterfaceClass");

  for (var key in classes) {
    var cls = classes[key];
    if (cls.num_subclasses === 0) continue;
    var subclasses = cls.subclasses;
    dump_enum2(subclasses, "InterfaceSubclass" + cls.name);
    for (var skey in subclasses) {
      var subclass = subclasses[skey];
      if (subclass.num_interfaces === 0) continue;
      dump_enum2(subclass.interfaces, "InterfaceSubclass" + cls.name + "Protocol" + subclass.name);
    }
  }
}

if (process.argv.length > 2) {
  process_file(process.argv[2], function() {
    //console.log("packets = " + JSON.stringify(out) + ";");
    dump_enum(classes);
  });
} else {
  console.log("usage: <filename>");
}
