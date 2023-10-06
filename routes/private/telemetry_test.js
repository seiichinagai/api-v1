const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
const express = require('express');
const router = express.Router();
const time = require('time');
const createError = require('http-errors');
// const ffr_notification = require('./ffr_notification');
// const ffrr_notification = require('./ffrr_notification');

// handles actual POST
router.post('/', (req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const strauth = new Buffer(b64auth, 'base64').toString();
  const splitIndex = strauth.indexOf(':'); 
  const login = strauth.substring(0, splitIndex);
  const password = strauth.substring(splitIndex + 1);

  if (login == "automate_green" && password == "k&iAmV$Evd" || login == "shifted_api" && password == "k&iAmV$Evd"){
    var jsonStatuses = JSON.parse(JSON.stringify(req.body).replace('testStatuses','statuses'));
    var jsonStatusesClean = removeDuplicates(jsonStatuses['statuses']);
    console.log('received test status payload. Length: ' + jsonStatusesClean['statuses'].length);

    var command = '/var/www/html/api.shiftedenergy.com/telemetry/send_stats.sh ' + "'" + JSON.stringify(jsonStatusesClean).replace('testStatuses','statuses') + "'";
    try {
      exec(command, function(execerr,stdout){
          if(stdout && stdout.indexOf('200')>=0){
            var phplog = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/telemetry/logs/php.log', {'flags': 'a'});
            phplog.write(new Date().toISOString() + '\tphp\t' + stdout)
            phplog.end();
          } else if (stdout){
            alert_slack();
            var phplog = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/telemetry/logs/php.log', {'flags': 'a'});
            console.log('WebDNA endpoint failed to receive status, trying again.');
            try_again(command);
            phplog.write(new Date().toISOString() + '\t ERROR ' + stdout)
            phplog.end();
          } else {
            alert_slack();
            var phplog = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/telemetry/logs/php.log', {'flags': 'a'});
            console.log('WebDNA endpoint failed to receive status, trying again.');
            try_again(command);
            phplog.write(new Date().toISOString() + '\t telemetry ERROR\n')
            phplog.end();
          }
          if(execerr){
            console.log(execerr);
          }
          if (!res.headersSent){
            res.status(200).json({
              message: 'Success'
            });
          }
        });
    } catch(command_err){
      console.log(command_err);
      return next(createError(400, 'forwarding error'));
    }
    if (!res.headersSent){
      res.status(200).json({
        message: 'Success'
      });
    }
    get_creds(jsonStatusesClean);
  } else {
    return next(createError(400, 'Unauthorized'));
  }
});

function get_creds(jsonStatuses){
  const post_log = '/var/www/html/api.shiftedenergy.com/logs/telemetry_post.log';
  fs.readFile('/var/www/html/api.shiftedenergy.com/reference/client_creds.db', 'utf8', function(crederr,creds){
    if (crederr) {
      var logstream = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/telemetry/logs/forwarding.log', {'flags': 'a'});
      logstream.write(new Date().toISOString() + '\tcredit err: ' + crederr + '\n');
      logstream.end();
    }
    try {
      client_creds = JSON.parse(creds);
    } catch (json_err2) {
      var logstream = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/telemetry/logs/forwarding.log', {'flags': 'a'});
      logstream.write(new Date().toISOString() + '\tclient_cred err: ' + json_err2 + '\n');
      logstream.end();
    }
    fs.readFile('/var/www/html/api.shiftedenergy.com/telemetry/devices_by_client.db', function(err,stdout){
      var devices_by_client = [];
      try {
        devices_by_client = JSON.parse(stdout)['clients'];
      } catch (jsonerr){
        var logstream = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/telemetry/logs/forwarding.log', {'flags': 'a'});
        logstream.write(new Date().toISOString() + '\tdevices_by_client err: ' + jsonerr + '\n');
        logstream.end();
      }
      var ffr_triggers = {};
      var ffrr_triggers = {};
      jsonStatuses['statuses'].forEach(function(status, i){
        // console.log(status['deviceId']);
        // if device exists in telemetry client device list
        if(JSON.stringify(devices_by_client).indexOf(status['deviceId']) >= 0){
          // find which client it belongs to
          devices_by_client.forEach(function(client){
            // if it's a telemetry client
            if(JSON.stringify(client['controllers']).indexOf(status['deviceId']) >= 0){
              //send regular status to client
              if(status && status['info'] && Object.keys(status['info']).includes('power')){
                var body = format(client['client'], status);
                var url = client_creds[client['client']]['url'] + client_creds[client['client']]['telemetry_url'];
                var command = '/var/www/html/api.shiftedenergy.com/scripts/' + client['client'] + '_post.sh ' + url + " '" + JSON.stringify(body) + "'";
                // Forward telemetry to client
                exec(command, function(clienterr,response){
                  if(clienterr){
                    var logstream = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/telemetry/logs/forwarding.log', {'flags': 'a'});
                    logstream.write(new Date().toISOString() + '\t' + clienterr + '\n')
                    logstream.end();
                  }
                  //console.log(new Date().toISOString().substring(0,16) + ' ' + client['client'] + ' ' + status['deviceId'] + ', success: ' + (response.indexOf('SUCCESS') > 0));
                });
                if(client['client'] == 'oati'){
                  var meta_groups_file = '/var/www/html/api.shiftedenergy.com/reference/meta_groups/meta_groups.db';
                  fs.readFile(meta_groups_file, 'utf-8', function(mg_file_err,mgs){
                    if (mg_file_err){
                      console.log(mg_file_err);
                    } else {
                      var meta_groups = JSON.parse(mgs);
                      client_creds[client['client']]['meta_groups'].forEach(function(client_meta_group){
                        meta_groups['meta_groups'].forEach(function(meta_group){
                          if(meta_group['meta_group'] == client_meta_group && JSON.stringify(meta_group).indexOf(status['deviceId']) > 0){
                            var oatistream = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/telemetry/telem_by_meta_group/' + meta_group['meta_group'] + '.db', {'flags': 'a'});
                            oatistream.write(status['deviceId'] + '\t' + status['date'] + '\t' + status['info']['power'] + '\n')
                            oatistream.end();
                          }
                        });
                      });
                      // console.log(new Date().toISOString() + '\tForwarding telemetry for ' + status['deviceId'] + ' to ' + client['client']);
                    }
                  });
                }
              } 
              // detect FFR Trigger
              else if (client['ffr'] == 'true' && status && status['reason'] && status['reason'] == 'ffr' && status['type'] && status['type'] == 'trigger'){
                var meta_groups_file = '/var/www/html/api.shiftedenergy.com/reference/meta_groups/meta_groups.db';
                fs.readFile(meta_groups_file, 'utf-8', function(mg_file_err,mgs){
                  if (mg_file_err){
                    console.log(mg_file_err);
                  } else {
                    var meta_groups = JSON.parse(mgs);
                    client_creds[client['client']]['ffr_meta_groups'].forEach(function(ffr_meta_group){
                      meta_groups['meta_groups'].forEach(function(meta_group){
                        if(meta_group['meta_group'] == ffr_meta_group && JSON.stringify(meta_group).indexOf(status['deviceId']) > 0){
                          console.log(status['date'] + ' ffr trigger, ' + meta_group['meta_group'] + ', device: ' + status['deviceId']);
                          // HERE
                          if (JSON.stringify(ffr_triggers).indexOf(client['client']) < 0) {
                            ffr_triggers[client['client']]={};
                            ffr_triggers[client['client']][meta_group['meta_group']] = [];
                            ffr_triggers[client['client']][meta_group['meta_group']].push(status['deviceId']);
                          } else if (JSON.stringify(ffr_triggers[client['client']]).indexOf([meta_group['meta_group']]) < 0){
                            ffr_triggers[client['client']][meta_group['meta_group']] = [];
                            ffr_triggers[client['client']][meta_group['meta_group']].push(status['deviceId']);
                          } else {
                            ffr_triggers[client['client']][meta_group['meta_group']].push(status['deviceId']);
                          }
                          // threshold?
                          if(ffr_triggers[client['client']][meta_group['meta_group']].length == 5){
                            alert_slack_regional('TEST: Regional FFR Event detected for ' + ffr_meta_group + ', device: ' + status['deviceId'])
                          }
                          if(ffr_triggers[client['client']][meta_group['meta_group']].length >= 20 && JSON.stringify(ffr_triggers[client['client']][meta_group['meta_group']]).indexOf('SENT')<0){
                            var to_send = {}
                            to_send['client'] = client['client'];
                            to_send['meta_group'] = meta_group['meta_group'];
                            to_send['devices'] = ffr_triggers[client['client']][meta_group['meta_group']];
                            ffr_triggers[client['client']][meta_group['meta_group']].push('SENT');
                            ffr_notification(JSON.stringify(client_creds),JSON.stringify(to_send),status['date'],status['info']['frequency']);
                          }
                        }
                      })
                    })
                  }
                })
              }
              // detect FFRR
              else if (client['ffr'] == 'true' && status && status['reason'] && status['reason'] == 'ffrr' && status['type'] && status['type'] == 'trigger'){
                var meta_groups_file = '/var/www/html/api.shiftedenergy.com/reference/meta_groups/meta_groups.db';
                fs.readFile(meta_groups_file, 'utf-8', function(mg_file_err,mgs){
                  if (mg_file_err){
                    console.log(mg_file_err);
                  } else {
                    var meta_groups = JSON.parse(mgs);
                    client_creds[client['client']]['ffr_meta_groups'].forEach(function(ffr_meta_group){
                      meta_groups['meta_groups'].forEach(function(meta_group){
                        if(meta_group['meta_group'] == ffr_meta_group && JSON.stringify(meta_group).indexOf(status['deviceId']) > 0){
                          console.log(status['date'] + ' ffr trigger, ' + meta_group['meta_group'] + ', device: ' + status['deviceId']);
                          if (JSON.stringify(ffrr_triggers).indexOf(client['client']) < 0) {
                              ffrr_triggers[client['client']]={};
                              ffrr_triggers[client['client']][meta_group['meta_group']] = [];
                              ffrr_triggers[client['client']][meta_group['meta_group']].push(status['deviceId']);
                            } else if (JSON.stringify(ffrr_triggers[client['client']]).indexOf([meta_group['meta_group']]) < 0){
                              ffrr_triggers[client['client']][meta_group['meta_group']] = [];
                              ffrr_triggers[client['client']][meta_group['meta_group']].push(status['deviceId']);
                            } else {
                              ffrr_triggers[client['client']][meta_group['meta_group']].push(status['deviceId']);
                            }
                            if(ffrr_triggers[client['client']][meta_group['meta_group']].length >= 20 && JSON.stringify(ffrr_triggers[client['client']][meta_group['meta_group']]).indexOf('SENT')<0){
                              var to_send = {}
                              to_send['client'] = client['client'];
                              to_send['meta_group'] = meta_group['meta_group'];
                              to_send['devices'] = ffrr_triggers[client['client']][meta_group['meta_group']];
                              ffrr_triggers[client['client']][meta_group['meta_group']].push('SENT');
                              ffrr_notification(JSON.stringify(client_creds),JSON.stringify(to_send),status['date'],status['info']['frequency']);
                            }
                        }
                      })
                    })
                  }
                })
              }
            }
          });
        }
      });
    });
  });
}

function format(client, status){
  var now = new Date();
  switch(client){
    case 'oati':
      var body = {
        "Header":{
          "Source":"SEI",
          "Destination":"HECO GSDS",
          "Message":"Telemetry",
          "MessageId":now.getTime(),
          "TimeStamp":now.toISOString(),
          "Unit":"kW"
        },
        "Telemetry":[
          {
            "MeterId":status['deviceId'],
            "Type":"KW 5 Minute",
            "Measurements":[
              {
                "EndDateTime":status['date'],
                "Value":(status['info']['power'] * 12 / 1000).toFixed(3)
              }
            ]
          }
        ]
      }
      // console.log(JSON.stringify(body,null,2));
      return body;
    break;
    case 'turning_tables':
      var body = {
        "statuses":[]
      }
      body['statuses'].push(status);
      return body;
    break;
    case 'blerp':
      var body = {
        "Header":{
          "Source":"SEI",
          "Destination":"HECO GSDS",
          "Message":"Telemetry",
          "MessageId":now.getTime(),
          "TimeStamp":now.toISOString(),
          "Unit":"kW"
        },
        "Telemetry":[
          {
            "MeterId":status['deviceId'],
            "Type":"KW 5 Minute",
            "Measurements":[
              {
                "EndDateTime":status['date'],
                "Value":(status['info']['power'] * 12 / 1000).toFixed(3)
              }
            ]
          }
        ]
      }
      return body;
    break;
    default:
      var logstream = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/telemetry/logs/forwarding.log', {'flags': 'a'});
      logstream.write(new Date().toISOString() + '\tclient' + client + ' not found\n');
      logstream.end();
  }
}

function try_again(command){
  console.log(command);
  exec(command, function(execerr,stdout){
    if(stdout && stdout.indexOf('200')>=0){
      var phplog = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/telemetry/logs/php.log', {'flags': 'a'});
      phplog.write(new Date().toISOString() + '\tphp\t' + stdout)
      phplog.end();
    }
  });
}

function alert_slack(){
  // alert slack
  var json = {
    "text": 'Telemetry: No response from WebDNA php endpoint'
  }
  var slack_command = '/var/www/html/api.shiftedenergy.com/scripts/slack_err_alert.sh ' + "'" + JSON.stringify(json) + "'";
  exec(slack_command,function(slackerr,slackresponse){
    if(slackerr){
      console.log(slackerr);
    } else if(slackresponse){
      console.log(slackresponse);
    }
  });
}

function removeDuplicates(arr){
  var stats = {
    'statuses':[]
  }
  stats['statuses'] = arr.filter((obj, pos, a) => {
    return a.map(mapObj => mapObj["id"]).indexOf(obj["id"]) === pos;
  });
  return stats;
}

function alert_slack_regional(string){
  // alert slack
  var json = {
    "text": string
  }
  var slack_command = '/var/www/html/api.shiftedenergy.com/scripts/slack_alert.sh ' + "'" + JSON.stringify(json) + "'";
  exec(slack_command,function(slackerr,slackresponse){
    if(slackerr){
      console.log(slackerr);
    } else if(slackresponse){
      console.log(slackresponse);
    }
  });
}

module.exports = router;