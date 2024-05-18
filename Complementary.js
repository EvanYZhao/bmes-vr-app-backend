import lodash from "lodash";
import * as math from "mathjs"
import { Quaternion } from "./Quaternion.js";

// Helper fxn: Returns the shape of an array
// (Assumes consistent sizing across all nesting)
export function shape(arr) {
    if (!Array.isArray(arr)) {
        return [];
    }
    const sizes = [];
    let current = arr;
    while (Array.isArray(current)) {
        sizes.push(current.length);
        current = current[0];
    }
    return sizes;
}

// Helper fxn: Normalizes a 2D array
function normalizeRows(arr) {
    let normalizedArr = [];
    for (let i = 0; i < arr.length; i++) {
        let row = arr[i];
        let norm = math.norm(row);
        if (norm === 0) {
            throw new Error("Norm of the row is zero, cannot normalize.");
        }
        let normalizedRow = row.map((value) => value / norm);
        normalizedArr.push(normalizedRow);
    }

    return normalizedArr;
}

export default class Complementary {
    constructor(gyr, acc, Dt, gain = 0.9) {
        this.gyr = gyr;
        this.acc = acc;
        this.Dt = Dt;
        this.gain = gain;
        this._assert_validity_of_inputs();
        if (this.gyr != null && this.acc != null) {
            this.W = this._compute_all();
        }
    }

    // Parameter Input Validity Checker
    _assert_validity_of_inputs() {
        // Checking array dimensionality
        const arr_attributes = ["gyr", "acc"];
        for (let att of arr_attributes) {
            let cur_dim = shape(this[att]);
            if (cur_dim[cur_dim.length - 1] != 3) {
                throw new Error(
                    `${att} parameter expects dimension (3) or (N, 3):  Got (${cur_dim}) instead`
                );
            }

            if (cur_dim.length != 2) {
                throw new Error(`${att} array expects a 2D array`);
            }
        }

        // Check equality of gyr and acc dimensions
        if (!lodash.isEqual(shape(this.gyr), shape(this.acc))) {
            throw new Error(
                `gyr and acc parameters must have same dimension: gyr dim is (${shape(
                    this.gyr
                )}), acc dim is (${shape(this.acc)})`
            );
        }

        // Check constraints of other numerical parameters
        const num_attributes = ["Dt", "gain"];
        for (let att of num_attributes) {
            if (typeof this[att] !== "number") {
                throw new Error(
                    `${att} is not of type Number. Saw a type of ${typeof this[
                        att
                    ]}`
                );
            }
            if (this[att] < 0) {
                throw new Error(
                    `${att} should be non-negative. Saw a value of ${this[att]}`
                );
            }
        }
    }

    // Compute estimations using complementary filter (IMU only)
    _compute_all() {
        let W = math.zeros(shape(this.acc));

        let W2 = this.am_estimation(this.acc);

        W[0] = W2[0];

        // Complementary Filter
        for (let i = 1; i < W.length; i++) {
            // W[i][0] = (W[i - 1][0] + this.gyr[i][0] * this.Dt) * this.gain + W2[i][0] * (1.0 - this.gain)
            W[i][0] = math.multiply(
                math.add(math.multiply(this.gyr[i][0], this.Dt), W[i - 1][0]),
                math.add(this.gain, math.multiply(W2[i][0], 1.0 - this.gain))
            );
            // W[i][1] = (W[i - 1][1] + this.gyr[i][1] * this.Dt) * this.gain + W2[i][1] * (1.0 - this.gain)
            W[i][1] = math.multiply(
                math.add(math.multiply(this.gyr[i][1], this.Dt), W[i - 1][1]),
                math.add(this.gain, math.multiply(W2[i][1], 1.0 - this.gain))
            );
        }
        return W;
    }

    // Attitude estimation for accelerometer
    am_estimation(acc) {
        let angles = math.zeros(shape(acc));

        // Estimating tilt angles (pitch)
        let a = normalizeRows(acc);
        for (let i = 0; i < angles.length; i++) {
            angles[i][0] = math.atan2(a[i][1], a[i][2]); // Pitch
            angles[i][1] = math.atan2(
                -a[i][0],
                math.sqrt(a[i][1] ** 2 + a[i][2] ** 2)
            ); // Roll
        }
        return angles;
    }

    // Gets "mixed" data in form of quaternion
    Q() {
        if ('W' in this) {
            this.W[0] // This is the 1D array holding pitch, roll, and yaw
            return (new Quaternion(this.W[0]))._from_rpy()
        } else {
            throw new Error("No data available to perform attitude estimation")
        }
    }
}

// Testing
let gyr = [[0.025699745547073327, -0.0202, -0.277]];
let acc = [[0.01992992, -0.05502688, 1.0256]];
let test = new Complementary(gyr, math.multiply(acc, 9.8), 0.1);
console.log(test.Q())

