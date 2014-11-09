var fs = require('fs');
var parser = require('./structs_parser.js');
var lexer = new parser.Lexer(fs.readFileSync(__dirname + '/structs.defs', 'utf8'));
var parser = new parser.Parser(lexer);

var nodes = parser.parse();

//console.log(JSON.stringify(tree, null, 2));

var enums = { };
var structs = { };

function calculate_struct_size(s) {
  var body = s.body;
  var size = 0;
  for (var i = 0, il = body.length; i < il; ++i) {
    var n = body[i];
    size += n.size;
  }
  return size;
}

function bytes_needed_for_bits(n) {  // Number of bytes needed to store bits.
  return (n + 7) >> 3;
}

function mask_for_bits(n) {
  return (1 << n) - 1;
}

function flatten_body(body, flat, prefix) {
  for (var i = 0, il = body.length; i < il; ++i) {
    var n = body[i];

    if (n.type!== 'uint') {
      if (structs[n.type] !== undefined) {
        flatten_body(structs[n.type].body, flat, prefix + n.type + ".");
      } else {
        flat.push({name: prefix + n.name, size: n.size, enum_name: n.type});
      }
      continue;
    }

    flat.push({name: prefix + n.name, size: n.size});
  }
}

function generate_enum_code(e) {
  var body = e.body;

  var map = { };
  var p = 0;
  for (var i = 0, il = body.length; i < il; i += 2) {
    var name = body[i], val = body[i+1];
    if (val) p = val;
    map[p++] = name;
  }

  // JSON stringifies the numeric keys, but nicer to keep them.
  var mapcode = JSON.stringify(map).replace(/"([0-9]+)":/g, "$1:");

  return 'var e' + e.name + ' = ' + mapcode + ';';
}

function generate_struct_code(s) {
  var size = calculate_struct_size(s);
  var bytes = bytes_needed_for_bits(size);
  var code = "function parse_" + s.name + "(f, b, s, e) {\n";
  code += '  if (s + ' + bytes + ' > e) throw "Truncated data";\n';
  code += '  var val, r = 0;\n';
  var body = s.body;
  var bits_in_r = 0;
  var pos = 0;

  var flat_body = [ ];
  flatten_body(s.body, flat_body, "");

  for (var i = 0, il = flat_body.length; i < il; ++i) {
    var n = flat_body[i];
    var more_needed = n.size - bits_in_r;
    if (more_needed > 0) {
      var more_bytes = bytes_needed_for_bits(more_needed);
      code += '  r |= '
      var first = true;
      while (more_bytes--) {
        if (first !== true) code += ' | ';
        code += 'b[s+' + pos + ']';
        if (bits_in_r !== 0) code += ' << ' + bits_in_r;
        ++pos; bits_in_r += 8;
        first = false;
      }
      code += ';\n';
    }
    var mask = mask_for_bits(n.size);
    var namelookup = 'null';
    if (n.enum_name !== undefined)
      namelookup = 'e' + n.enum_name + '[val]';
    code += '  val = r & 0x' + mask.toString(16) + '; ' +
      'f.add_field("' + n.name + '", ' + n.size + ', val, ' + namelookup + ');\n';
    code += '  r >>= ' + n.size + ';\n';
    bits_in_r -= n.size;
  }
  code += "}\n";

  return code;
}

console.log(
  "function Fields() {\n" +
  "  var fields = [ ];\n" +
  "  this.add_field = function(name, size, val, display) {\n" +
  "    fields.push(name, size, val, display);\n" +
  "  };\n" +
  "  this.get_value = function(name) {\n" +
  "    for (var i = 0, il = fields.length; i < il; i += 4) {\n" +
  "      if (fields[i] === name) return fields[i+2];\n" +
  "    }\n" +
  "    return undefined;\n" +
  "  };\n" +
  "  this.put_on_object = function(obj) {\n" +
  "    for (var i = 0, il = fields.length; i < il; i += 4) {\n" +
  "      obj[fields[i]] = fields[i+2];\n" +
  "    }\n" +
  "    return undefined;\n" +
  "  };\n" +
  "  this.debug_string = function(prefix) {\n" +
  "    var ftext = '';\n" +
  "    for (var i = 0, il = fields.length; i < il; i += 4) {\n" +
  "      if (i !== 0) ftext += '\\n';\n" +
  "      ftext += prefix + fields[i] + ':' + fields[i+1] + ' 0x' + fields[i+2].toString(16);\n" +
  "      if (fields[i+3] !== null) ftext += ' (' + fields[i+3] + ')';\n" +
  "    }\n" +
  "    return ftext;\n" +
  "  };\n" +
  "}\n"
);

for (var i = 0, il = nodes.length; i < il; ++i) {
  var n = nodes[i];
  if (n.node_type === "enum") {
    console.log(generate_enum_code(n));
    enums[n.name] = n;
    continue;
  }
  if (n.node_type === "struct") {
    console.log(generate_struct_code(n));
    structs[n.name] = n;
    continue;
  }
  throw "xx";
}

console.log("try {");
console.log("  exports.Fields = Fields;");
for (var i = 0, il = nodes.length; i < il; ++i) {
  var n = nodes[i];
  var prefix = n.node_type === "enum" ? "e" : "parse_";
  var name = prefix + n.name;
  console.log("  exports." + name + " = " + name + ";");
}
console.log("} catch(e) { }");
