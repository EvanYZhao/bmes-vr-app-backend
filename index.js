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

let angle = 0
let vel_window = [null, null, null]

const broadcast = (data) => {
   Object.keys(connections).forEach((uuid) => {
      const connection = connections[uuid];
      connection.send(`${data}`);
   });
};

const handleClose = (uuid) => {
   // If raspberry pi disconnecting, reset angle and velocity window
   if (uuid == "raspberry") {
      angle = 0
      vel_window = [null, null, null]
   }
   delete connections[uuid];
};

// Only allows connection if matches server-side device password or
// matches a logged in user UID in firebase auth table
const authorizeConnection = async (token) => {
   if (token === process.env.DEVICE_PRIVATE_KEY) {
      console.log("Raspberry Pi connected");
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

function simpsonsIntegration(val) {
   const angularVelocity = parseFloat(val);

   // Update the window, shifting everything to the right
   vel_window[2] = vel_window[1]
   vel_window[1] = vel_window[0]
   vel_window[0] = angularVelocity

   // If not enough points have been accumulated, then return a filler angle of 0
   for (let i = 0; i < 3; i++) {
      if (vel_window[i] === null) {
         return "0.0"
      }
   } // Otherwise, enough datapoints have been accumulated so run below code

   // Perform Simpson's rule integration to obtain angle with 3 most recent angular velocities
   angle += (0.15 / 3) * (vel_window[0] + 4 * vel_window[1] + vel_window[2])

   return angle.toFixed(2)

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
            const ang_vel_one = parsed.angle
            const cervical_flex_reading = parsed.cflex
            const thoracic_flex_reading = parsed.tflex
            const lumbar_flex_reading = parsed.lflex

            console.log(JSON.parse(message))


            // Deriving angle from angular velocity
            const ang_one = simpsonsIntegration(ang_vel_one)

            // Broadcasting the data to the web app
            broadcast((ang_one, cervical_flex_reading, thoracic_flex_reading, lumbar_flex_reading))
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
