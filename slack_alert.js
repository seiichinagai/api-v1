// const fs = require('fs');

// exports.slack_alert = function(string){
//   return 'cunt';
//   // var json = {
//   //   "text": string
//   // }
//   // var slack_command = '/var/www/html/api.shiftedenergy.com/scripts/slack_err_alert.sh ' + "'" + JSON.stringify(json) + "'";
//   // exec(slack_command,function(slackerr,slackresponse){
//   //   if(slackerr){
//   //     console.log(slackerr);
//   //   } else if(slackresponse){
//   //     console.log(new Date().toISOString() + ', ' + string + ', slack response: ' + slackresponse);
//   //   }
//   // })
// }

module.exports = {
  add: function (a, b) {
    return a + b;
  },
  subtract: function (a, b) {
    return a - b;
  }
}