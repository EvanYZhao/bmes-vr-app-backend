require("dotenv").config();
const { getAuth } = require("firebase-admin/auth");
const { credential, auth } = require("firebase-admin");
const { initializeApp } = require("firebase-admin/app");
const WebSocket = require("ws");
const uuidv4 = require("uuid").v4;
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
   host: "0.0.0.0",
   port: port,
});

const connections = {};

const broadcast = (data) => {
   Object.keys(connections).forEach((uuid) => {
      const connection = connections[uuid];
      connection.send(`${data}`);
   });
};

const handleClose = (uuid, who) => {
   if (who === "device") {
      console.log("Raspberry Pi disconnected");
   } else {
      console.log(who, "disconnected");
   }
   delete connections[uuid];
};

// Only allows connection if matches server-side device password or
// matches a logged in user UID in firebase auth table
const authorizeConnection = (ws, token) => {
   const uuid = uuidv4();
   if (token === process.env.DEVICE_PRIVATE_KEY) {
      console.log("Raspberry Pi connected");
      connections[uuid] = ws;
      ws.on("message", (message) => broadcast(message));
      ws.on("close", () => handleClose(uuid, "device"));
   } else {
      getAuth(app)
         .getUser(token)
         .then((userRecord) => {
            console.log(userRecord.displayName + " connected");
            connections[token] = ws;
            ws.on("message", (message) => broadcast(message));
            ws.on("close", () => handleClose(token, userRecord.displayName));
         })
         .catch((e) => {
            console.error("Could not authorize user:", e);
            ws.write("401 Unauthorized \r\n\r\n");
            ws.close();
            return;
         });
   }
};

const authorizeUpgrade = (ws, token, req, head) => {
   const uuid = uuidv4();
   if (token === process.env.DEVICE_PRIVATE_KEY) {
      server.handleUpgrade(req, ws, head, (ws) => {
         ws.emit("connection", ws, req);
      });
   } else {
      getAuth(app)
         .getUser(token)
         .then(() => {})
         .catch((e) => {
            console.error("Could not authorize user:", e);
            ws.write("HTTP 401 Unauthorized \r\n\r\n");
            ws.close();
            return;
         });
   }
};

// Listens for a connection
server.on("connection", (ws, req) => {
   if (!req.url.includes("?")) {
      console.error("No query in URL");
      ws.close();
   }

   const token = req.url.slice(process.env.SLICE_INT);
   authorizeConnection(ws, token);
});

// Listens for incompatible request connection
server.on("upgrade", (req, ws, head) => {
   const token = req.url.slice(process.env.SLICE_INT);
   authorizeConnection(ws, token, req, head);
});
