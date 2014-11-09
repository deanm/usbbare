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

/** @const */ var kRegexSym    = /^[a-zA-Z_][a-zA-Z0-9_]*/;
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
      if (val === "struct" || val === "enum") return token_keyword(val);
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

function expr_enum(name, body) {
  return {node_type: 'enum', name: name, body: body};
}

function expr_struct(name, body) {
  return {node_type: 'struct', name: name, body: body};
}

function expr_typedvar(type, name, size) {
  return {node_type: 'typedvar', type: type, name: name, size: size};
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

  function body_enum() {
    var body = [ ];
    while (true) {
      var peek = peekToken();
      if (peek.token_type === "}") break;
      var name = nextTokenExpect("sym");
      peek = peekToken();
      val = null;
      if (peek.token_type === '=') {
        nextTokenExpect('=');
        val = nextTokenExpect('int').left;
      }
      nextTokenExpect(";");
      body.push(name.left, val);
    }
    return body;
  }

  function body_struct() {
    var body = [ ];
    while (true) {
      var peek = peekToken();
      if (peek.token_type === "}") break;
      var type = nextTokenExpect("sym");
      var name = nextTokenExpect("sym");
      nextTokenExpect(":");
      var size = nextTokenExpect("int");
      nextTokenExpect(";");
      body.push(expr_typedvar(type.left, name.left, size.left));
    }
    return body;
  }

  function expression() {
    var obj = nextToken();
    if (obj === null) return null;
    if (obj.token_type !== "keyword") throw "Expected keyword";

    nextTokenExpect("{");
    var body = obj.left === "struct" ? body_struct() : body_enum();
    nextTokenExpect("}");
    var name = nextTokenExpect("sym");

    if (obj.left === "enum") {
      nextTokenExpect(";");
      return expr_enum(name.left, body);
    }

    nextTokenExpect(";");

    return expr_struct(name.left, body);

    throw "Parse error";
  }

  this.parse = function() {
    var expressions = [ ];
    while (true) {
      var expr = expression();
      if (expr === null) break;
      expressions.push(expr);
    }
    return expressions;
  };
}

try { exports.Lexer = Lexer; exports.Parser = Parser; } catch(e) { }
