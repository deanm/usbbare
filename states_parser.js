var kDummyWhitespaceToken = { };

function is_whitespace_token(t) {
  return t === kDummyWhitespaceToken;
}

function token_whitespace() {
  return function(c) {
    return kDummyWhitespaceToken;
  };
}

function token_generic() {
  return function(c) {
    return {token_type: c};
  };
}

function token_keyword(name) {
  return {token_type: 'keyword', left: name};
}

function token_sym(name) {
  return {token_type: 'sym', left: name};
}

function token_int(val) {
  return {token_type: 'int', left: val};
}

/** @const */ var kRegexSym    = /^[a-zA-Z_][a-zA-Z0-9_\.]*/;
/** @const */ var kRegexIntOct = /^0[0-7]*/;
/** @const */ var kRegexIntDec = /^[1-9][0-9]*/;
/** @const */ var kRegexIntHex = /^0[xX][0-9a-fA-F]+/;
/** @const */ var kRegexLexers = [
  kRegexIntHex, function(x) { return parseInt(x, 16); }, token_int,
  kRegexIntOct, function(x) { return parseInt(x,  8); }, token_int,
  kRegexIntDec, function(x) { return parseInt(x, 10); }, token_int,
  kRegexSym,    null,                                    token_sym
];

var kSimpleTokens = {
  " ":   token_whitespace(),
  "\t":  token_whitespace(),
  "\r":  token_whitespace(),
  "\n":  token_whitespace(),
  "{":   token_generic(),
  "}":   token_generic(),
  ";":   token_generic(),
  ":":   token_generic(),
  "//":  token_generic(),
  "=":   token_generic(),
  ",":   token_generic(),
};

function Lexer(str) {
  var p = 0;
  var len = str.length;

  this.pos = function() { return p; }
  this.set_pos = function(np) { p = np; };

  function seekToEndOfLine() {
    while (p < len && str[p] !== "\n" && str[p] !== "\r") ++p;
  }

  this.nextTokenFull = function() {
    if (p >= len) return null;

    var left = len - p;

    // 1 character "simple" tokens.
    var simple = kSimpleTokens[str[p]];
    if (simple !== undefined)
      return simple(str[p++]);

    // 2 character "simple" tokens.
    if (left >= 2) {
      var s = str.substr(p, 2);
      simple = kSimpleTokens[s];
      if (simple !== undefined) {
        p += 2;
        return simple(s);
      }
    }

    var cur = str.substr(p);

    for (var i = 0, il = kRegexLexers.length; i < il; i += 3) {
      var regex = kRegexLexers[i], mapper = kRegexLexers[i+1], tokenfunc = kRegexLexers[i+2];
      var match = cur.match(regex);
      if (match === null) continue;
      var val = match[0];
      p += val.length;
      if (mapper !== null) return tokenfunc(mapper(val));
      if (val === "state" || val === "want" || val === "need") return token_keyword(val);
      return token_sym(val);
    }

    throw "Failed in lexing input: " + cur;
    return null;
  };

  this.nextToken = function() {
    while (true) {
      var token = this.nextTokenFull();
      if (token === null) return null;
      // Discard whitespace.
      if (is_whitespace_token(token)) continue;
      // Discard comments.
      if (token.token_type === "//") { seekToEndOfLine(); continue; }
      return token;
    }
  }
}

function expr_rule(type, predicates, commands) {
  return {node_type: "rule", type: type, predicates: predicates, commands: commands};
}

function expr_state(name, intype, inputs, rules) {
  return {node_type: "state", intype: intype, name: name, inputs: inputs, rules: rules};
}

function expr_command(name, args) {
  return {node_type: "command", name: name, args: args};
}

function Parser(lexer) {

  function nextToken() {
    var token = lexer.nextToken();
    return token;
  }

  function nextTokenExpect(type) {
    var token = nextToken();
    if (token === null)
      throw "Syntax error: unexpected end of input";
    if (token.token_type !== type) {
      console.trace("Syntax error: Expected " + type + " but got " + JSON.stringify(token));
      throw "Syntax error: Expected " + type + " but got " + JSON.stringify(token);
    }
    return token;
  }

  function peekToken() {
    var save = lexer.pos();
    var token = nextToken();
    lexer.set_pos(save);
    return token;
  }

  function peekNextIs(type) {
    var peek = peekToken();
    if (peek !== null && peek.token_type === type) return true;
    return false;
  }

  function consumeNextIf(type) {
    if (peekNextIs(type)) {
      nextTokenExpect(type);
      return true;
    }
    return false;
  }

  function parse_command() {
    if (peekNextIs("keyword")) {
      var keyword = nextTokenExpect("keyword").left;
      if (keyword === "want" || keyword === "need") return parse_rule(keyword);
      throw "xx";
    }
    var command = nextTokenExpect("sym").left;
    var args = [ ];
    while (true) {
      if (peekNextIs(";")) break;
      if (peekNextIs("sym")) {
        args.push(nextTokenExpect("sym").left);
      } else {
        args.push(nextTokenExpect("int").left);
      }
    }
    nextTokenExpect(";");
    return expr_command(command, args);
  }

  function parse_rule(type) {
    var predicates = [ [ ] ];

    while (true) {
      if (peekNextIs("{")) break;
      if (consumeNextIf(",")) {
        predicates.push([ ]);
        continue;
      }
      var field = nextTokenExpect("sym").left;
      var value = null;
      if (consumeNextIf(":")) {
        if (peekNextIs("sym")) {
          value = nextTokenExpect("sym").left;
        } else {
          value = nextTokenExpect("int").left;
        }
      }
      predicates[predicates.length-1].push(field, value);
    }

    nextTokenExpect("{");

    var commands = [ ];

    while (true) {
      if (peekNextIs("}")) break;
      commands.push(parse_command());
    }

    nextTokenExpect("}");

    return expr_rule(type, predicates, commands);
  }

  function parse_state() {
    var name = nextTokenExpect("sym");
    var inputs = [ ];

    nextTokenExpect(":");
    var intype = nextTokenExpect("sym");

    if (consumeNextIf(":")) {
      while (true) {
        if (peekNextIs("{")) break;
        if (inputs.length !== 0) nextTokenExpect(",");
        var iname = nextTokenExpect("sym");
        inputs.push(iname.left);
      }
    }

    nextTokenExpect("{");
    var rules = [ ];
    while (true) {
      if (peekNextIs("}")) break;
      var type = nextTokenExpect("keyword");
      rules.push(parse_rule(type.left));
    }

    nextTokenExpect("}");

    return expr_state(name.left, intype.left, inputs, rules);
  }

  function statement() {
    var obj = nextToken();
    if (obj === null) return null;
    if (obj.token_type !== "keyword") throw "Expected keyword";

    if (obj.left !== "state") throw "xx";

    var state = parse_state();
    return state;
  }

  this.parse = function() {
    var statements = [ ];
    while (true) {
      var expr = statement();
      if (expr === null) break;
      statements.push(expr);
    }
    return statements;
  };
}

try { exports.Lexer = Lexer; exports.Parser = Parser; } catch(e) { }
