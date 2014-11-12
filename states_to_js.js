var fs = require('fs');
var parser = require('./states_parser.js');
var filename = "transfer.states";
var lexer = new parser.Lexer(fs.readFileSync(__dirname + '/' + filename, 'utf8'));
var parser = new parser.Parser(lexer);

var nodes = parser.parse();

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
  for (var i = 0, il = kShorthands.length; i < il; ++i) {
    var o = kShorthands[i];
    for (var j = 0, jl = o.length; j < jl; ++j) {
      if (s === o[j]) return ["pid_type", i, "pid_name", j];
    }
  }
  throw "xx: " + s;
}

var kPPFields = ["pid_type", "pid_name", "data", "ADDR", "EndPoint"];

function generate_rule_code(locals, intype, rule, pre) {
  var code = "";
  var expression = "";

  var parse_name = null;

  function scope_mapper(x) {
    if (x === "nil") return "[ ]";
    if (x === "null") return "null";
    if (locals.indexOf(x) !== -1) return x;
    if (locals.indexOf(x.split('.')[0]) !== -1)
      return x.split('.')[0] + ".get_value(" + JSON.stringify(x.split('.').slice(1).join('.')) + ")";
    if (x === parse_name) return x;
    if (x.split('.')[0] === parse_name)
      return parse_name + ".get_value(" + JSON.stringify(x.split('.').slice(1).join('.')) + ")";
    if (kPPFields.indexOf(x.split('.')[0]) !== -1) return "pp." + x;
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
      if (r.length === 4)
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
        if (intype === "packet") {
          code = pre + "var " + val + " = new structs.Fields();\n" + code;
          expression += "structs.parse_" + val + "(" + val + ", rp, 1, rp.length-2)";
        } else {
          code = pre + "var " + val + " = pp." + val + ";\n";
          expression += "pp.transaction_type === " + JSON.stringify(val);
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

  for (var j = 0, jl = rule.commands.length; j < jl; ++j) {
    var command = rule.commands[j];
    if (command.node_type === "rule") {
      code += generate_rule_code(locals.concat(parse_name !== null ? [parse_name] : [ ]),
          intype, command, pre + "  ");
      continue;
    }
    if (command.node_type !== "command") throw "xx";
    var args = command.args;
    var emits = false;
    switch (command.name) {
      case "dec":
        var sargs = args.map(scope_mapper);
        code += pre + "  " + sargs[0] + " -= " + sargs[1] + ";\n";
        break;
      case "transition":
        if (next !== "kPass") throw "xx";
        var sargs = args.slice(1).map(scope_mapper);
        next = "state_" + args[0] + "_" + intype + "(" + sargs.join(", ") + ")";
        next_name = args[0];
        break;
      case "append":
        var sargs = args.map(scope_mapper);
        //code += pre + "  " + args[0] + " = " + args[0] + ".concat(" + args[1] + ");\n";
        code += pre + "  " + sargs[0] + " = [" + sargs[0] + ", " + sargs[1] + "];\n";
        break;
      case "emit":
        var sargs = args.slice(1).map(scope_mapper);
        code += pre + "  cb.emit(" + JSON.stringify(args[0]) + ", state, [" + sargs.join(", ") + "]);\n";
        break;
      case "spawn":
        var sargs = args.slice(1).map(scope_mapper);
        code += pre + "  cb.spawn(" + JSON.stringify(args[0]) + ", state, [" + sargs.join(", ") + "]);\n";
        break;
      case "restart":
        var sargs = args.slice(1).map(scope_mapper);
        code += pre + "  cb.restart(" + JSON.stringify(args[0]) + ", state, [" + sargs.join(", ") + "]);\n";
        break;

      case "end":
        if (next !== "kPass") throw "xx";
        next = "kEnd";
        break;
      default:
        throw command.name;
        break;
    }
  }
  if (next_name === null) next_name = next;
  code += pre + "  return {next: " + next + ", next_name: " + JSON.stringify(next_name) + "};\n";
  code += pre + "}\n";
  // TODO: check was last rule
  if (rule.type === "need")
    code += pre + 'throw "Missed needed rule in state: ' + n.name + '";\n';
  return code;
}

function generate_state_code(n) {
  var code = "function state_" + n.name + "_" + n.intype + "(" + n.inputs.join(", ") + ") {\n" +
             "  return function(cb, state, rp, pp) {\n";

  var rules = n.rules;

  var has_fields = false;

  for (var i = 0, il = rules.length; i < il; ++i) {
    var rule = rules[i];
    code += generate_rule_code(n.inputs, n.intype, rule, "    ");
  }
  code += "    return {next: kPass};\n";
  code += "  };\n";
  code += "}\n";
  return code;
}

console.log("// This code is autogenerated from " + filename + "\n");
console.log("var structs = require('./structs.js');\n");
console.log("var kPass = { }, kEnd = { };\n");
for (var i = 0, il = nodes.length; i < il; ++i) {
  var n = nodes[i];
  if (n.node_type !== "state") throw "xx";
  console.log(generate_state_code(n));
}

console.log("try {");
  console.log("  exports.kPass = kPass;");
  console.log("  exports.kEnd = kEnd;");
for (var i = 0, il = nodes.length; i < il; ++i) {
  var n = nodes[i];
  var name = "state_" + n.name + "_" + n.intype;
  console.log("  exports." + name + " = " + name + ";");
}
console.log("} catch(e) { }");
