const express = require('express');
const app = express();

const bodyParser = require("body-parser");
const PORT = process.env.PORT || 5000;

__path = process.cwd();

require('events').EventEmitter.defaultMaxListeners = 500;

/* ---------- Middleware ---------- */
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/* ---------- Routes ---------- */
const code = require('./pair');
app.use('/code', code);

app.get('/', async (req, res) => {
    res.sendFile(__path + '/pair.html');
});

/* ---------- Server ---------- */
app.listen(PORT, '0.0.0.0', () => {
    console.log(`⏩ Server running on http://0.0.0.0:${PORT}`);
});

module.exports = app;
