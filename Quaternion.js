import { shape } from "./Complementary.js";
import * as math from "mathjs";

export class Quaternion {
    constructor(angles) {
        this.angles = angles;
    }

    _from_rpy() {
        let cur_dim = shape(this.angles);
        if (cur_dim[0] != 3) {
            throw new Error(
                `angles parameter expects dimension (3):  Got (${cur_dim[0]}) instead`
            );
        }

        for (let angle of this.angles) {
            if (angle < -2.0 * math.pi || angle > 2.0 * math.pi) {
                throw new Error(
                    `Expected angles must be in range [-2pi, 2pi]. Got ${this.angles} instead.`
                );
            }
        }

        let roll = this.angles[0];
        let pitch = this.angles[1];
        let yaw = this.angles[2];
        let cy = math.cos(0.5 * yaw);
        let sy = math.sin(0.5 * yaw);
        let cp = math.cos(0.5 * pitch);
        let sp = math.sin(0.5 * pitch);
        let cr = math.cos(0.5 * roll);
        let sr = math.sin(0.5 * roll);

        let q = [0, 0, 0, 0];
        q[0] = cy * cp * cr + sy * sp * sr;
        q[1] = cy * cp * sr - sy * sp * cr;
        q[2] = cy * sp * cr + sy * cp * sr;
        q[3] = sy * cp * cr - cy * sp * sr;

        return q;
    }
}
