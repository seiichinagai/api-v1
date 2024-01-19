const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const crypto = require('crypto');
const js2xml = require('js2xmlparser');

// POST
router.get('/', (req, res, next) => {
  res.redirect('https://auth.tesla.com/oauth2/v3/authorize?&client_id=3b3e744b9b89-4591-8253-e31f747ae3dc&locale=en-US&prompt=login&redirect_uri=https://api.shiftedenergy.com/redirect_uri&response_type=code&scope=openid%20offline_access%20user_data%20vehicle_device_data%20vehicle_cmds%20vehicle_charging_cmds&state=abcd')
});

module.exports = router;