const fs = require('fs')
if (!fs.existsSync('./build')) {
    fs.mkdirSync('./build')
}
fs.writeFileSync('./build/index.html', fs.readFileSync('./index.html'));
console.log('build is successs!')