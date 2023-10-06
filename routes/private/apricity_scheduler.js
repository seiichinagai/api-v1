const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
const express = require('express');
const router = express.Router();
const time = require('time');
const createError = require('http-errors');

// handles actual POST
router.post('/', (req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const strauth = new Buffer(b64auth, 'base64').toString();
  const splitIndex = strauth.indexOf(':'); 
  const login = strauth.substring(0, splitIndex);
  const password = strauth.substring(splitIndex + 1);

  if (login == "shifted_api" && password == "k&iAmV$Evd"){
    try {
      if(!res.headerSent && !req.files) {
          res.send({
              status: false,
              message: 'No file uploaded'
          });
          next();
      } else {
        //Use the name of the input field (i.e. "file") to retrieve the uploaded file
        let file = req.files;
        var json;

        try {
          json = JSON.parse(file.data.data);
        } catch(jsonErr){
          console.log(jsonErr)
        }

        if(json && json.clearSchedule){
          // console.log(json)
          fs.writeFile('/var/www/html/api.shiftedenergy.com/scheduler/apricity_clears/' + file.data.name, file.data.data.toString('utf-8'), function(err){
            if(err){console.log(err);}
            // console.log(file.data.data.toString('utf-8'))
            var run_scheduler_command = '/var/www/html/api.shiftedenergy.com/scheduler/run_clear_schedule.sh ' + file.data.name;
            console.log(run_scheduler_command)
            exec(run_scheduler_command,function(err,stdout){
              if(err){
                console.log(err);
              }
              if(stdout){
                console.log(stdout)
              }
            })
            // send response
            if(!res.headerSent){
              res.send({
                message: 'clearSchedule file upload successful',
                name: file['data']['name']
              });
              next();
            }
          });
        } else {
          // Use the mv() method to place the file in upload directory (i.e. "uploads")
          fs.writeFile('/var/www/html/api.shiftedenergy.com/scheduler/apricity_uploads/' + file.data.name, file.data.data.toString('utf-8'), function(err){
            if(err){console.log(err);}
            // console.log(file.data.data.toString('utf-8'))
            var run_scheduler_command = '/var/www/html/api.shiftedenergy.com/scheduler/run_apricity_scheduler.sh ' + file.data.name;
            console.log(run_scheduler_command)
            exec(run_scheduler_command,function(err,stdout){
              if(err){
                console.log(err);
              }
              if(stdout){
                console.log(stdout)
              }
            })
            // send response
            if(!res.headerSent){
              res.send({
                message: 'File upload successful',
                name: file['data']['name']
              });
              next();
            }
          });
        }
      }
    } catch (err) {
      console.log(err);
      if(!res.headerSent){
        res.status(500).send(err);
        next();
      }
    }
  } else {
    return next(createError(400, 'Unauthorized'));
  }
});



module.exports = router;