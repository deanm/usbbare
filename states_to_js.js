var fs = require('fs');
var parser = require('./states_parser.js');

//console.log(JSON.stringify(nodes, null, 2));

var constants = {
  "special": 0, "token": 1, "handshake": 2, "data": 3,
  "out": 0, "sof": 1, "in": 2, "setup": 3,
  "ack": 0, "nyet": 1, "nak": 2, "stall": 3,
  "data0": 0, "data2": 1, "data1": 2, "mdata": 3,
};

var kShorthands = [
  [ ],
  ["OUT", "SOF", "IN", "SETUP"],
  ["ACK", "NYET", "NAK", "STALL"],
  ["DATA0", "DATA2", "DATA1", "MDATA"]
];

function find_short_replacement(s) {
  if (s === "SSPLIT") {
    return ["pid_type", 0, "pid_name", 2, "SC", 0];
  } else if (s === "CSPLIT") {
    return ["pid_type", 0, "pid_name", 2, "SC", 1];
  }

  for (var i = 0, il = kShorthands.length; i < il; ++i) {
    var o = kShorthands[i];
    for (var j = 0, jl = o.length; j < jl; ++j) {
      if (s === o[j]) return ["pid_type", i, "pid_name", j];
    }
  }
  if (exports.indexOf(s) !== -1)
    return ["typename", JSON.stringify(exports[exports.indexOf(s)])];
  console.log(exports);
  throw "xx: " + s;
}

function litstr(str) {
  return JSON.stringify(str);
}

var kPPFields = [
  "pid_type", "pid_name", "data", "ADDR", "EndPoint",
  "HubAddr", "SC", "Port", "S", "U", "ET"];
var kTransactionFields = [
  "ADDR",
  "EndPoint",
  "data",
  "setup",
  "bmRequestType",
  "bRequest",
  "wValue",
  "wIndex",
  "wLength",
];

var exports = [ ];

function generate_rule_code(locals, transtype, typename, rule, pre) {
  var code = "";
  var expression = "";

  var parse_name = null;

  function scope_mapper(x) {
    if (x === "nil") return "[ ]";
    if (x === "null") return "null";
    if (x === "typename") return "_pp.typename";
    if (locals.indexOf(x) !== -1) return x;
    if (locals.indexOf(x.split('.')[0]) !== -1)
      return x.split('.')[0] + ".get_value(" + JSON.stringify(x.split('.').slice(1).join('.')) + ")";
    if (x === parse_name) return x;
    if (x.split('.')[0] === parse_name)
      return parse_name + ".get_value(" + JSON.stringify(x.split('.').slice(1).join('.')) + ")";
    if (transtype === "transfer" && kTransactionFields.indexOf(x) !== -1) return "_pp.out." + x;
    if (x.split('.')[0] === "setup")
      return "_pp.out.setup.get_value(" + JSON.stringify(x.split('.').slice(1).join('.')) + ")";
    if (transtype === "transaction" && kPPFields.indexOf(x.split('.')[0]) !== -1) return "_pp." + x;
    if (kTransactionFields.indexOf(x.split('.')[0]) !== -1) return "_pp.out." + x;
    // TODO properly manage scope, Fields need to be kept track of, etc.
    return locals[locals.length-1] + ".get_value(" + JSON.stringify(x) + ")";
  }

  var preds = rule.predicates;
  for (var j = 0, jl = preds.length; j < jl; ++j) {
    var pred = preds[j].slice();

    // Map from shorthand like "ACK" to the pid_name and pid_type fields.
    for (var w = 0, wl = pred.length; w < wl; w += 2) {
      if (pred[w+1] !== null) continue;
      var r = find_short_replacement(pred[w]);
      if (r.length === 6)
        pred.splice(w, 2, r[0], r[1], r[2], r[3], r[4], r[5]);
      else if (r.length === 4)
        pred.splice(w, 2, r[0], r[1], r[2], r[3]);
      else
        pred.splice(w, 2, r[0], r[1]);
      wl += 2;
    }

    if (j !== 0) expression += " ||\n    " + pre;
    if (jl !== 1) expression += "(";
    for (var w = 0, wl = pred.length; w < wl; w += 2) {
      var name = pred[w], val = pred[w+1];
      if (w !== 0) expression += " && ";
      if (val === null) {
        expression += kShorthand[name];
        continue;
      }
      if (name === "parse") {
        if (1||transtype === "packet") {
          code = pre + "var " + val + " = new structs.Fields();\n" + code;
          expression += "structs.parse_" + val + "(" + val + ", _pp.data, 0, _pp.data.length)";
        } else {
          code = pre + "var " + val + " = _pp." + val + ";\n";
          expression += "_pp.transaction_type === " + JSON.stringify(val);
        }
        parse_name = val;
        continue;
      } else {
        name = scope_mapper(name);
      }

      if (typeof(val) === "string" && val.toLowerCase() in constants)
        val = constants[val.toLowerCase()] + ' /* ' + val + ' */';
      expression += name + " === " + val;
    }
    if (jl !== 1) expression += ")";
  }

  if (expression.length === 0) expression = "1";

  code += pre + "if (" + expression + ") {\n";

  var next = "kPass";
  var next_name = null;

  var do_break = false;

  for (var j = 0, jl = rule.commands.length; j < jl; ++j) {
    var command = rule.commands[j];
    if (command.node_type === "rule") {
      code += generate_rule_code(locals.concat(parse_name !== null ? [parse_name] : [ ]),
          transtype, typename, command, pre + "  ");
      continue;
    }
    if (command.node_type !== "command") throw "xx";
    var args = command.args;
    switch (command.name) {
      case "dec":
        var sargs = args.map(scope_mapper);
        code += pre + "  " + sargs[0] + " -= " + sargs[1] + ";\n";
        break;
      case "transition":
        if (next !== "kPass") throw "xx";
        var sargs = args.slice(1).map(scope_mapper);
        next = "state_" + typename + "_" + args[0] + sargs.length + "(" + sargs.join(", ") + ")";
        next_name = args[0];
        break;
      case "append":
        var sargs = args.map(scope_mapper);
        code += pre + "  " + sargs[0] + " = " + sargs[0] + ".concat([" + sargs[1] + ", _meta]);\n";
        break;
      case "spawn":
        var sargs = args.slice(1).map(scope_mapper);
        code += pre + "  _cb.spawn(" + litstr(args[0]) + ", " +
            litstr(transtype) + ", " + litstr(typename) + ", " + "_state);\n";
        break;
      case "success":
        code += pre + "  _cb.emit(" + litstr(transtype) + ", " + litstr(typename) + ", true, _out, _state);\n";
        if (next !== "kPass") throw "xx"; next = "kEnd";
        break;
      case "failed":
        code += pre + "  _cb.emit(" + litstr(transtype) + ", " + litstr(typename) + ", false, _out, _state);\n";
        if (next !== "kPass") throw "xx"; next = "kEnd";
        break;
      case "capture":
        code += pre + "  _out." + args[0] + " = " + scope_mapper(args[1]) + ";" +
                " _out." + args[0] + "_m = _meta;\n";
        break;
      case "pop":
        code += pre + "  _state." + args[0] + ".pop();\n";
        break;
      case "break":
        do_break = true;
        continue;
      case "die":
        if (next !== "kPass") throw "xx"; next = "kEnd";
        break;
      case "debuglog":
        code += pre + '  console.log("debuglog");\n';
        code += pre + '  console.log(_out);\n';
        code += pre + '  console.log(_pp);\n';
        var sargs = args.map(scope_mapper);
        code += pre + '  ' + sargs.map(function(x) { return 'console.log('+x+')'; }) + ';\n';
        break;
      default:
        throw command.name;
        break;
    }
  }
  if (next_name === null) next_name = next;
  code += pre + "  return {next: " + next + ", next_name: " + litstr(transtype + "::" + next_name) + ", do_break: " + do_break + "};\n";
  code += pre + "}\n";
  // TODO: check was last rule
  if (rule.type === "need") {  // Same as calling failed
    code += pre + "_cb.emit(" + litstr(transtype) + ", " + litstr(typename) + ", false, _out, _state);\n";
    code += pre + "return {next: kEnd, next_name: \"kEnd\"};\n";
  }
  return code;
}

function generate_state_code(n, transtype, typename) {
  var funcname = "state_" + typename + "_" + n.name + n.inputs.length;
  exports.push(funcname);
  var code = "function " + funcname + "(" + n.inputs.join(", ") + ") {\n" +
             "  return function(_pp, _out, _meta, _state, _cb) {\n";

  var rules = n.rules;

  var has_fields = false;

  for (var i = 0, il = rules.length; i < il; ++i) {
    var rule = rules[i];
    code += generate_rule_code(n.inputs, transtype, typename, rule, "    ");
  }
  code += "    return {next: kPass};\n";
  code += "  };\n";
  code += "}\n";
  return code;
}

function generate_trans_code(n) {
  var code = "function " + n.typename + "() {\n";
  var fn = n.fields;
  for (var i = 0, il = fn.length; i < il; ++i) {
    code += "  this." + fn[i] + " = undefined;\n";
    code += "  this." + fn[i] + "_m = undefined;\n";
  }
  code += "}\n\n";
  exports.push(n.typename);

  var states = n.states;
  for (var i = 0, il = states.length; i < il; ++i) {
    var state = states[i];
    code += generate_state_code(state, n.type, n.typename);
  }
  return code;
}

if (process.argv.length < 3) {
  console.log("usage: <filename.js>");
  process.exit(1);
}

var filename = process.argv[2];
var lexer = new parser.Lexer(fs.readFileSync(__dirname + '/' + filename, 'utf8'));
var parser = new parser.Parser(lexer);
var nodes = parser.parse();

console.log("// This code is autogenerated from " + filename + "\n");
console.log("var structs = require('./structs.js');\n");
console.log("var kPass = { }, kEnd = { };\n");
exports.push("kPass", "kEnd");
for (var i = 0, il = nodes.length; i < il; ++i) {
  var n = nodes[i];
  if (n.node_type !== "trans") throw "xx";
  console.log(generate_trans_code(n));
}

console.log("try {");
for (var i = 0, il = exports.length; i < il; ++i) {
  console.log("  exports." + exports[i] + " = " + exports[i]+ ";");
}
console.log("} catch(e) { }");
