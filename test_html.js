var fs = require('fs');

function cleanify_varname(x) {
  return x.replace(/[^0-9a-zA-Z_]/g, '_');
}

var rollups = [ ];

function roll_up_js(filename, amroot) {
  var src = fs.readFileSync(__dirname + '/' + filename, 'utf8');
  src = src.replace(/require\('(.*?)'\)/g, function(match, p1) {
    var varname = 'import_' + cleanify_varname(p1);
    rollups.push(varname, '(function(exports) {var module={exports:exports};' +
                           roll_up_js(p1, false) + ' return module.exports;})({});');
    return 'import_' + cleanify_varname(p1);
  });

  var rollsrc = '';
  for (var i = 0, il = rollups.length; amroot && i < il; i += 2) {
    if (rollups.indexOf(rollups[i]) < i) continue;
    rollsrc += "var " + rollups[i] + " = " + rollups[i+1] + ";\n";
  }

  return rollsrc + src;
}

console.log('<html><head><style>' + fs.readFileSync(__dirname + '/usbbarev0.css', 'utf8'));
console.log('</style><script>');
if (process.argv > 2) {
  console.log(fs.readFileSync(process.argv[2], 'utf8'));
} else {
  console.log("rawpcapdata = null;");
}
console.log('</script><script>' + roll_up_js('/usbbarev0.js', true));
console.log('</script><body></body></html>');
