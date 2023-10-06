const express = require('express');
const fileUpload = require('express-fileupload');
const app = express();
const morgan = require('morgan');
const xmlparser = require('express-xml-bodyparser');
const bodyParser = require('body-parser');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const createError = require('http-errors');
const helmet = require('helmet');
const featurePolicy = require('feature-policy')
/*const path = require('path');
const winston = require('winston'); */

//const error_log = "/var/www/html/api.shiftedenergy.com/logs/error.log";
//const request_log = "/var/www/html/api.shiftedenergy.com/logs/request.log";

//var error_stream = fs.createWriteStream(error_log, {flags:'a'});
//var request_stream = fs.createWriteStream(request_log, {flags:'a'});


// Private
const updateProjectsRoute = require('./routes/private/update_projects');
const updateSplitRoute = require('./routes/private/update_split');
const ffrNotificationRoute = require('./routes/private/ffr_notification');
const updateMetaGroupRoute = require('./routes/private/update_meta_group');
const telemetryTestRoute = require('./routes/private/telemetry_test');
const schedulerRoute = require('./routes/private/scheduler');
const agSchedulerV2Route = require('./routes/private/ag_scheduler_v2');
const apricitySchedulerRoute = require('./routes/private/apricity_scheduler');
const updateHMACRoute = require('./routes/private/update_HMAC');
const oatiWeeklyUploadRoute = require('./routes/private/oati_weekly_upload');
const oatiFFRUploadRoute = require('./routes/private/oati_ffr_upload');
const resetApricityRoute = require('./routes/private/reset_apricity');
const araFFRConfigRoute = require('./routes/private/ara_ffr_config');
const resetAGRoute = require('./routes/private/reset_ag');
const agFFRConfigRoute = require('./routes/private/ag_ffr_config');
const updateExportGroupsRoute = require('./routes/private/update_export_groups');
const econetRoute = require('./routes/private/econet');
const redirectURIRoute = require('./routes/private/redirect_uri');

// Authentication
const validateUserRoute = require('./routes/authentication/validate_user');


// Individual Device Data Access
const deviceForecastRoute = require('./routes/individual_device_data_access/get_device_forecast');
const deviceInfoRoute = require('./routes/individual_device_data_access/get_device_info');
const deviceTelemetryRoute = require('./routes/individual_device_data_access/get_device_telemetry');
const deviceOnChangeTelemetryRoute = require('./routes/individual_device_data_access/get_device_on_change_telemetry');
const historicalDataRoute = require('./routes/individual_device_data_access/get_historical_wh_data');
const araWhDataRoute = require('./routes/individual_device_data_access/get_device_wh_data_ara');
const agWhDataRoute = require('./routes/individual_device_data_access/get_device_wh_data');


// Group Data Access
const metaGroupInfoRoute = require('./routes/group_data_access/get_metagroup_info');
const metaInfoGroupsRoute = require('./routes/group_data_access/get_meta_info_authorized_groups');
const controllersInGroupRoute = require('./routes/group_data_access/get_controllers_in_group');
const devicesInGroupRoute = require('./routes/group_data_access/get_devices_in_group');
const baselineForecastRoute = require('./routes/group_data_access/get_baseline_forecast');
const fourDayBaselineForecastRoute = require('./routes/group_data_access/get_group_four_day_baseline_forecast');
const multipleGroupFourDayBaselineForecastRoute = require('./routes/group_data_access/get_multiple_group_four_day_baseline_forecast');


// Individual Device Load Shift Management
const sendCommandRoute = require('./routes/individual_device_load_shift_management/send_device_command');
const sendAraCommandRoute = require('./routes/individual_device_load_shift_management/send_ara_command');
const getDeviceLoadShiftForecastRoute = require('./routes/individual_device_load_shift_management/get_device_load_shift_forecast');


// Group Load Shift Management
const groupLoadShiftForecastRoute = require('./routes/group_load_shift_management/get_group_load_shift_forecast');
const multipleGroupLoadShiftForecastRoute = require('./routes/group_load_shift_management/get_multiple_group_load_shift_forecast');
const groupLoadShiftReportRoute = require('./routes/group_load_shift_management/get_group_load_shift_report');
const loadShiftEventDetailsRoute = require('./routes/group_load_shift_management/get_load_shift_event_details');
const initiateLoadShiftRoute = require('./routes/group_load_shift_management/initiate_load_shift_event');
const initiateMultipleGroupLoadShiftRoute = require('./routes/group_load_shift_management/initiate_multiple_group_load_shift_event');


// Fast Frequency Response
const ffrEventDetailsRoute = require('./routes/fast_frequency_response/get_ffr_event_details');
const ffrGroupReportRoute = require('./routes/fast_frequency_response/get_ffr_group_report');
const getFfrGroupSettings = require('./routes/fast_frequency_response/get_ffr_group_settings');
const setFfrGroupRSettings = require('./routes/fast_frequency_response/set_ffr_group_settings');


// Emergency Demand Response



// Aggregator API
const aggregatorCapacityEventRoute = require('./routes/aggregator/event');
const aggregatorEndEventRoute = require('./routes/aggregator/cancel_event');
const aggregatorLoginRoute = require('./routes/aggregator/aggregator_login');
const ffrTestRoute = require('./routes/aggregator/ffr_test');

// Test 
const testCapacityEventRoute = require('./routes/test/event');
const testEndEventRoute = require('./routes/test/cancel_event');

app.use(helmet());

app.use(
  helmet.permittedCrossDomainPolicies({
    permittedPolicies: "none",
  })
);

app.use(
  helmet({
    referrerPolicy: { policy: "no-referrer" },
  })
);

app.use(
  helmet.hsts({
    maxAge: 31536000,
  })
);

app.use(
  helmet.frameguard({
    action: "deny",
  })
);

app.use(helmet.noSniff());

app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"]
    },
  })
);

app.use(
  helmet.referrerPolicy({
    policy: "no-referrer",
  })
);

app.use(featurePolicy({
  features: {
    vibrate: ["'none'"],
    geolocation: ["'none'"]
  }
}))


// middleware
// API server
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  message: '{"error":"Too many requests, please try again later."}'
});
app.use(limiter);

app.use(morgan('combined', {
  stream:
      fs.createWriteStream("/var/www/html/api.shiftedenergy.com/logs/access.log", { flags: 'a' }),
  skip: function(req, res) {
    if(req.get('User-Agent')){
      return (req.get('User-Agent').indexOf("ELB") >= 0 || req.get('User-Agent').indexOf("SetCronJob") >= 0);
    }
  }
}));

// enable files upload
app.use(fileUpload({
    createParentPath: true
}));

app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({limit: '50mb', extended: true}));
//app.use(bodyParser.json({limit: '50mb'}));
//app.use(bodyParser.urlencoded({limit: '50mb', extended: true, parameterLimit:50000}));
app.use(xmlparser({trim: false, explicitArray: false}));

// Prevents CORS errors
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'GET, POST');
    return res.status(200).json({});
  }
  next();
});

// Private
app.use('/update_projects', updateProjectsRoute);
app.use('/update_split', updateSplitRoute);
app.use('/ffr/nab82bdkg9j24sgzj', ffrNotificationRoute);
app.use('/update_meta_group', updateMetaGroupRoute);
app.use('/telemetry_test', telemetryTestRoute);
app.use('/scheduler', schedulerRoute);
app.use('/ag_scheduler_v2', agSchedulerV2Route);
app.use('/apricity_scheduler', apricitySchedulerRoute);
app.use('/aprhmac', updateHMACRoute);
app.use('/oati_weekly_upload', oatiWeeklyUploadRoute);
app.use('/oati_ffr_upload', oatiFFRUploadRoute);
app.use('/reset_apricity', resetApricityRoute);
app.use('/ara_ffr_config', araFFRConfigRoute);
app.use('/reset_ag', resetAGRoute);
app.use('/ag_ffr_config', agFFRConfigRoute);
app.use('/update_export_groups', updateExportGroupsRoute);
app.use('/econet', econetRoute);
app.use('/redirect_uri', redirectURIRoute);

// Authentication
app.use('/validate_user', validateUserRoute);

// Individual Device Data Access
app.use('/get_device_forecast', deviceForecastRoute);
app.use('/get_device_info', deviceInfoRoute);
app.use('/get_device_telemetry', deviceTelemetryRoute);
app.use('/get_device_on_change_telemetry', deviceOnChangeTelemetryRoute);
app.use('/get_historical_wh_data', historicalDataRoute);
app.use('/get_device_wh_data_ara', araWhDataRoute);
app.use('/get_device_wh_data', agWhDataRoute);


// Group Data Access
app.use('/get_metagroup_info', metaGroupInfoRoute);
app.use('/get_meta_info_authorized_groups', metaInfoGroupsRoute);
app.use('/get_baseline_forecast', baselineForecastRoute);
app.use('/get_controllers_in_group', controllersInGroupRoute);
app.use('/get_devices_in_group', devicesInGroupRoute);
// app.use('/get_group_four_day_baseline_forecast', fourDayBaselineForecastRoute);
// app.use('/get_multiple_group_four_day_baseline_forecast', multipleGroupFourDayBaselineForecastRoute);

// Individual Device Load Shift Management
app.use('/send_device_command', sendCommandRoute);
app.use('/send_ara_command', sendAraCommandRoute);
app.use('/get_device_load_shift_forecast', getDeviceLoadShiftForecastRoute);

// Group Load Shift Management
app.use('/get_group_load_shift_forecast', groupLoadShiftForecastRoute);
app.use('/get_group_load_shift_report', groupLoadShiftReportRoute);
// app.use('/get_multiple_group_load_shift_forecast', multipleGroupLoadShiftForecastRoute);
app.use('/get_load_shift_event_details', loadShiftEventDetailsRoute);
app.use('/initiate_load_shift_event', initiateLoadShiftRoute);
// app.use('/initiate_multiple_group_load_shift_event', initiateMultipleGroupLoadShiftRoute);

// Fast Frequency Response
app.use('/get_ffr_event_details', ffrEventDetailsRoute);
app.use('/get_ffr_group_report', ffrGroupReportRoute);
app.use('/get_ffr_group_settings', getFfrGroupSettings);
app.use('/set_ffr_group_settings', setFfrGroupRSettings);

// Emergency Demand Response


// Aggregator
app.use('/event', aggregatorCapacityEventRoute);
app.use('/cancelevent', aggregatorEndEventRoute);
app.use('/aggregator_login', aggregatorLoginRoute);
app.use('/ffrtest', ffrTestRoute);

// Test
app.use('/test/event', testCapacityEventRoute);
app.use('/test/cancelevent', testEndEventRoute);





app.set('trust proxy', true);

app.get('/', function(req, res) {
  res.sendFile('/var/www/html/api.shiftedenergy.com/views/index.html');
});

// error handling
app.use((req, res, next) => {
  const error = new Error('Not found');
  error.status = 404;
  //next(error);
  console.log(new Date().toISOString())
  next(createError(error.status, error.message));
});

app.use((error, req, res, next) => {
  // This next comment; just going to forward the xml2js parser errors to the user
  if (!res.headersSent){
    if (error.message.includes("Unmatched closing tag:")) { // This error is thrown by xml2js, a dependency of
      // express-xml-bodyparser. It crashes the server, so I disabled the specific error throw in the node_module
      // but we'll still receive this, which is okay, doesn't crash server
      res.status(400);
      res.send('<error>Invalid POST body</error>');
    } else if (error.message.includes("Unclosed root tag")) {
      res.status(400);
      res.send('<error>Invalid POST body</error>');
    } else if (error.message.includes("Unexpected close tag")) {
      res.status(400);
      res.send('<error>Invalid POST body</error>');
    } else if (error.type == 'entity.parse.failed') {
      res.status(error.status || 400);
      res.json({
          error: 'Invalid POST body'
      });
    } else {
      res.status(error.status || 500);
      res.json({
          error: error.message
      });
    }
  }
});

module.exports = app;