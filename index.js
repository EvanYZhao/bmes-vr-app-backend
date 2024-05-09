require("dotenv").config();
const { getAuth } = require("firebase-admin/auth");
const { credential } = require("firebase-admin");
const { initializeApp } = require("firebase-admin/app");
const WebSocket = require("ws");
const serviceAccount = {
   type: process.env.FIREBASE_TYPE,
   project_id: process.env.FIREBASE_PROJECT_ID,
   private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
   private_key: process.env.FIREBASE_PRIVATE_KEY,
   client_email: process.env.FIREBASE_CLIENT_EMAIL,
   client_id: process.env.FIREBASE_CLIENT_ID,
   auth_uri: process.env.FIREBASE_AUTH_URI,
   token_uri: process.env.FIREBASE_TOKEN_URI,
   auth_provider_x509_cert_url:
      process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
   client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
   universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
};

const app = initializeApp({
   credential: credential.cert(serviceAccount),
});

const port = process.env.PORT || 3000;

const server = new WebSocket.Server({
   port: port,
});

const connections = {};

let angle1 = 0
let angle2 = 0
let vel_window1 = [null, null, null]
let vel_window2 = [null, null, null]
let prev_angle_1 = "0.0"
let prev_angle_2 = "0.0"
let currently_on = false
let rpi_connected = false

const broadcast = (data) => {
   Object.keys(connections).forEach((uuid) => {
      const connection = connections[uuid];
      connection.send(`${data}`);
   });
};

const handleClose = (uuid) => {
   // If raspberry pi disconnecting, reset angle and velocity window
   // and cached angle
   if (uuid == "raspberry") {
      angle1 = 0
      angle2 = 0
      vel_window1 = [null, null, null]
      vel_window2 = [null, null, null]
      prev_angle_1 = "0.0"
      prev_angle_2 = "0.0"
      rpi_connected = false
   }
   delete connections[uuid];
};

// Only allows connection if matches server-side device password or
// matches a logged in user UID in firebase auth table
const authorizeConnection = async (token) => {
   if (token === process.env.DEVICE_PRIVATE_KEY) {
      console.log("Raspberry Pi connected");
      rpi_connected = true
      return new Promise((resolve) => {
         resolve("raspberry");
      });
   } else {
      return new Promise((resolve, reject) => {
         getAuth(app)
            .getUser(token)
            .then((userRecord) => {
               console.log(userRecord.displayName + " connected");
               resolve(token);
            })
            .catch((e) => {
               console.error("Could not authorize user:", e);
               reject(e);
            });
      });
   }
};

// Only allows upgrade if matches server-side device password or
// matches a logged in user UID in firebase auth table
const authorizeUpgrade = (ws, token, req, head) => {
   if (token === process.env.DEVICE_PRIVATE_KEY) {
      server.handleUpgrade(req, ws, head, (ws) => {
         ws.emit("connection", ws, req);
      });
   } else {
      getAuth(app)
         .getUser(token)
         .then(() => {
            server.handleUpgrade(req, ws, head, (ws) => {
               ws.emit("connection", ws, req);
            });
         })
         .catch((e) => {
            console.error("Could not authorize user:", e);
            ws.close();
            return;
         });
   }
};

function simpsonsIntegration(val, imu) {
   const angularVelocity = parseFloat(val);
   
   if (imu) {
      // Update the window, shifting everything to the right
      vel_window1[2] = vel_window1[1]
      vel_window1[1] = vel_window1[0]
      vel_window1[0] = angularVelocity

      // If not enough points have been accumulated, then return the previous angle
      for (let i = 0; i < 3; i++) {
         if (vel_window1[i] === null) {
            return prev_angle_1
         }
      } // Otherwise, enough datapoints have been accumulated so run below code

      // Perform Simpson's rule integration to obtain angle with 3 most recent angular velocities
      angle1 += (0.15 / 3) * (vel_window1[0] + 4 * vel_window1[1] + vel_window1[2])
   } else {
      // Update the window, shifting everything to the right
      vel_window2[2] = vel_window2[1]
      vel_window2[1] = vel_window2[0]
      vel_window2[0] = angularVelocity

      // If not enough points have been accumulated, then return the previous angle
      for (let i = 0; i < 3; i++) {
         if (vel_window2[i] === null) {
            return prev_angle_2
         }
      } // Otherwise, enough datapoints have been accumulated so run below code

      // Perform Simpson's rule integration to obtain angle with 3 most recent angular velocities
      angle2 += (0.15 / 3) * (vel_window2[0] + 4 * vel_window2[1] + vel_window2[2])
   }

   // Set filler angle and clear velocity window
   if (imu) {
      vel_window1 = [null, null, null]
      prev_angle_1 = angle1.toFixed(2)
      return angle1.toFixed(2)
   } else {
      vel_window2 = [null, null, null]
      prev_angle_2 = angle2.toFixed(2)
      return angle2.toFixed(2)
   }
}

// Listens for a connection
server.on("connection", (ws, req) => {
   if (!req.url.includes("?")) {
      console.error("No query in URL");
      ws.close();
   }

   const token = req.url.slice(process.env.SLICE_INT);

   authorizeConnection(token)
      .then((key) => {
         connections[key] = ws;

         ws.on("message", (message) => {
            // Deconstructing the values received from raspberry pi
            const parsed = JSON.parse(message)
            const pump = parsed.pump_power
            const ang_vel_one = parsed.angular_vel1
            const ang_vel_two = parsed.angular_vel2
            const cervical_flex_reading = parsed.cflex
            const thoracic_flex_reading = parsed.tflex
            const lumbar_flex_reading = parsed.lflex

            // If the pump button gets pressed and the rpi is not connected,
            // then propagate no data at all
            if (pump != null && !rpi_connected) {
               return
            }

            // In case pump button gets pressed, then propagate pump ping
            // to raspberry pi and don't broadcast to the web app
            if (pump) {
               if ("raspberry" in connections) {
                  currently_on = true
                  rpi_con = connections["raspberry"]
                  console.log("Turning on pumps")
                  rpi_con.send(JSON.stringify({pump_power: pump}))
               }
               return
            }

            if (pump!= null && !pump && currently_on) {
               if ("raspberry" in connections) {
                  currently_on = false
                  rpi_con = connections["raspberry"]
                  console.log("Turning off pumps")
                  rpi_con.send(JSON.stringify({pump_power: pump}))
               }
               return
            }

            // Deriving angle from angular velocity
            const ang_one = simpsonsIntegration(ang_vel_one, true)
            const ang_two = simpsonsIntegration(ang_vel_two, false)

            // Creating an obj to send
            const json_data = {angle1: ang_one, angle2: ang_two, cflex: cervical_flex_reading, tflex: thoracic_flex_reading, lflex: lumbar_flex_reading}

            // Broadcasting the data to the web app
            broadcast(JSON.stringify(json_data))
         });
         ws.on("close", () => handleClose(key));
      })
      .catch(() => {
         ws.close();
      });
});

// Listens for incompatible request connection
server.on("upgrade", (req, ws, head) => {
   const token = req.url.slice(process.env.SLICE_INT);
   authorizeUpgrade(ws, token, req, head);
});
