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
import ComplementaryFilter from "./Complementary.js";
import * as math from "mathjs";

const app = initializeApp({
    credential: credential.cert(serviceAccount),
});

const port = process.env.PORT || 3000;

const server = new WebSocket.Server({
    port: port,
});

const connections = {};

let currently_on = false;
let rpi_connected = false;

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
        rpi_connected = false;
    }
    delete connections[uuid];
};

// Only allows connection if matches server-side device password or
// matches a logged in user UID in firebase auth table
const authorizeConnection = async (token) => {
    if (token === process.env.DEVICE_PRIVATE_KEY) {
        console.log("Raspberry Pi connected");
        rpi_connected = true;
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
                const parsed = JSON.parse(message);
                const pump = parsed.pump_power;
                const gyro_1 = parsed.gyro_1;
                const gyro_2 = parsed.gyro_2;
                const acc_1 = parsed.acc_1;
                const acc_2 = parsed.acc_2;
                const cervical_flex_reading = parsed.cflex;
                const thoracic_flex_reading = parsed.tflex;
                const lumbar_flex_reading = parsed.lflex;

                // If the pump button gets pressed and the rpi is not connected,
                // then propagate no data at all
                if (pump != null && !rpi_connected) {
                    return;
                }

                // In case pump button gets pressed, then propagate pump ping
                // to raspberry pi and don't broadcast to the web app
                if (pump) {
                    if ("raspberry" in connections) {
                        currently_on = true;
                        rpi_con = connections["raspberry"];
                        console.log("Turning on pumps");
                        rpi_con.send(JSON.stringify({ pump_power: pump }));
                    }
                    return;
                }

                if (pump != null && !pump && currently_on) {
                    if ("raspberry" in connections) {
                        currently_on = false;
                        rpi_con = connections["raspberry"];
                        console.log("Turning off pumps");
                        rpi_con.send(JSON.stringify({ pump_power: pump }));
                    }
                    return;
                }

                // Deriving angles using complementary filter
                const dt = 0.1;
                const quat1 = new ComplementaryFilter(gyro_1, acc_1, dt).Q();
                const quat2 = new ComplementaryFilter(gyro_2, acc_2, dt).Q();

                // Perform quat conversion to angle here
                let a1 = quat1[0];
                let i1 = quat1[1];
                let j1 = quat1[2];
                let k1 = quat1[3];
                const ang_one =
                    2 *
                    math.atan(
                        (2 * (a1 * i1 + j1 * k1)) /
                            (1 - 2 * math.sqrt(i1 ** 2 + j1 ** 2))
                    );

                let a2 = quat2[0];
                let i2 = quat2[1];
                let j2 = quat2[2];
                let k2 = quat2[3];
                const ang_two =
                    2 *
                    math.atan(
                        (2 * (a2 * i2 + j2 * k2)) /
                            (1 - 2 * math.sqrt(i2 ** 2 + j2 ** 2))
                    );

                // Creating an obj to send
                const json_data = {
                    angle1: ang_one,
                    angle2: ang_two,
                    cflex: cervical_flex_reading,
                    tflex: thoracic_flex_reading,
                    lflex: lumbar_flex_reading,
                };

                // Broadcasting the data to the web app
                broadcast(JSON.stringify(json_data));
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
