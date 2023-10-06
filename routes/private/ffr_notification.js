const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const crypto = require('crypto');
const js2xml = require('js2xmlparser');

/*
  Receive ffr notification from Brandon
      How to limit number of POSTS to the API server?
      What to do about outlier ffr updates? The weird ones?
        Need at least 10 within 1 minute to trigger ffr event?
  Parse controllers
      I need to know which controllers are in which group
      Create a file with the group # and the date
          Contains: Date, Time, ffr status (triggered/returned), number of controllers, 
                    trigger frequency, return frequency
  If trigger:
      Send representative trigger frequency to group's endpoint
  If return:
      Send return frequency to group's endpoint
*/











// POST
router.post('/', (req, res, next) => {
  if (req.header('Authorization') == 'Basic QXV0b21hdGVHcmVlbjpGNGxjMG4k') {
    res.status(200).json({
      success: 'success'
    });
  } else {
    res.status(401).json({
      error: 'Not Authorized'
    });
  }
  /*if (response_format == 'xml'){
    if (!req.body.root || !req.body.root.user || !req.body.root.user.email || !req.body.root.user.password || !req.body.root.group || 
        !req.body.root.trip_threshold || !req.body.root.return_threshold || !req.body.root.periods || !req.body.root.delay) {
      res.status(400);
      res.send('<error>Missing required field(s)</error>')
    } else {
      set_ffr_settings_xml(req, res);
    }
  } else if (response_format && response_format != 'xml' && response_format != 'json'){
    res.status(400).json({
      error: 'Invalid response_format parameter'
    });
  } else if (response_format == 'json' || !response_format) {
    if (!req.body.root || !req.body.root.user || !req.body.root.user.email || !req.body.root.user.password || !req.body.root.group || 
        !req.body.root.trip_threshold || !req.body.root.return_threshold || !req.body.root.periods || !req.body.root.delay) {
      res.status(400).json({
        error: 'Missing required field(s)'
      });
    } else {
        set_ffr_settings_json(req, res);
    }
  } else {
    res.status(400).json({
      error: 'Invalid request'
    });
  }*/
});

module.exports = router;