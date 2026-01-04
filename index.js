const express = require('express');
const app = express();
__path = process.cwd()
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 5000;
let code = require('./pair');
require('events').EventEmitter.defaultMaxListeners = 500;
app.use('/code', code);

app.use('/',async (req, res, next) => {
res.sendFile(__path + '/pair.html')
})

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.listen(PORT, () => {
app.listen(PORT, '0.0.0.0', () => {
console.log(`⏩ Server running on http://0.0.0.0:` + PORT)
});
module.exports = app
