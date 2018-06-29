import {Vector2, Vector3, Matrix4, Euler} from 'three';
import PhotogrammetricDistortion from '../cameras/PhotogrammetricDistortion';
import PhotogrammetricCamera from '../cameras/PhotogrammetricCamera';

function getText(xml, tagName) {
    var node = xml.getElementsByTagName(tagName)[0];
    return node && node.childNodes[0].nodeValue.trim();
}

function getNumbers(xml, tagName, value) {
    var text = getText(xml, tagName);
    return text ? text.split(' ').filter(String).map(Number) : value;
}

function getVector2(xml, tagName, value) {
    return new Vector2().fromArray(getNumbers(xml, tagName, value));
}

function getVector3(xml, tagName, value) {
    return new Vector3().fromArray(getNumbers(xml, tagName, value));
}

function getChildNumbers(xml, tagName) {
    return Array.from(xml.getElementsByTagName(tagName)).map(node => Number(node.childNodes[0].nodeValue));
}

function parseDistortion(xml) {
    xml = xml.children[0];
    var disto = { type: xml.tagName };
    var params;
    var states;
    if (disto.type === 'ModUnif') {
        disto.type = getText(xml, 'TypeModele');
        params = getChildNumbers(xml, 'Params');
        states = getChildNumbers(xml, 'Etats');
    }

    switch (disto.type) {
        case 'ModNoDist':
            return undefined;
        case 'ModRad':
            disto.C = getNumbers(xml, 'CDist'); // distortion center in pixels
            disto.R = getChildNumbers(xml, 'CoeffDist', []); // radial distortion coefficients
            disto.project = PhotogrammetricDistortion.projectRadial;
            return disto;
        case 'eModelePolyDeg2':
        case 'eModelePolyDeg3':
        case 'eModelePolyDeg4':
        case 'eModelePolyDeg5':
        case 'eModelePolyDeg6':
        case 'eModelePolyDeg7':
            disto.S = states[0];
            disto.C = states.slice(1, 3);
            disto.degree = Number(disto.type.substr('eModelePolyDeg'.length));

            // degree could be decreased if params has a long enough tail of zeroes
            var firstZero = params.length - params.reverse().findIndex(x => x !== 0);
            params.reverse();
            for (var d = disto.degree - 1; d > 0; --d) {
                var l = d * (d + 3) - 4; // = length of R at degree d, as l(2)=6 and l(n)=l(n-1)+2n+2
                if (firstZero <= l) {
                    params = params.slice(0, l);
                    disto.degree = d;
                }
            }
            disto.R = params;
            disto.project = PhotogrammetricDistortion.projectPolynom;
            return disto;
        case 'ModPhgrStd':
            disto.C = getNumbers(xml, 'CDist'); // distortion center in pixels
            disto.R = getChildNumbers(xml, 'CoeffDist'); // radial distortion coefficients
            disto.P = getNumbers(xml, 'P1', [0]).concat(getNumbers(xml, 'P2', [0]));
            disto.b = getNumbers(xml, 'b1', [0]).concat(getNumbers(xml, 'b2', [0]));
            disto.project = PhotogrammetricDistortion.projectFraser;
            return disto;
        case 'eModeleEbner':
            disto.B2 = states[0] * states[0] / 1.5;
            disto.P = params;
            disto.project = PhotogrammetricDistortion.projectEbner;
            return disto;
        case 'eModeleDCBrown':
            disto.F = states[0];
            disto.P = params;
            disto.project = PhotogrammetricDistortion.projectBrown;
            return disto;
        case 'eModele_FishEye_10_5_5':
        case 'eModele_EquiSolid_FishEye_10_5_5':
            disto.F = states[0];
            disto.C = params.slice(0, 2);
            disto.R = params.slice(2, 12);
            disto.P = params.slice(12, 22);
            disto.l = params.slice(22);
            disto.equisolid = disto.type === 'eModele_EquiSolid_FishEye_10_5_5';
            disto.project = PhotogrammetricDistortion.projectFishEye;
            return disto;
        default:
            throw new Error(`Error parsing micmac orientation : unknown distortion ${xml.tagName}`);
    }
}

function parseIntrinsics(xml) {
    if (!xml) {
        throw new Error('Error parsing micmac orientation, no intrinsics');
    }
    if (!(xml instanceof Node)) {
        xml = new window.DOMParser().parseFromString(xml, 'text/xml');
    }
    var KnownConv = getText(xml, 'KnownConv');
    if (KnownConv !== 'eConvApero_DistM2C') {
        throw new Error(`Error parsing micmac orientation : unknown convention ${KnownConv}`);
    }
    var focal = getVector2(xml, 'F'); // focal length in pixels
    var point = getVector2(xml, 'PP'); // image projection center in pixels
    var size = getVector2(xml, 'SzIm'); // image size in pixels
    var skew = 0;
    var rmax = getNumbers(xml, 'RayonUtile', [])[0];
    focal.y = focal.y || focal.x; // fy defaults to fx
    var distos = Array.from(xml.getElementsByTagName('CalibDistortion'))
        .map(parseDistortion)
        .filter(x => x) // filter undefined values
        .reverse(); // see the doc
    var near = focal.x * 0.035 / size.x; // horizontal focal length in meters, assuming a 35mm-wide sensor
    var far = 1000; // 1km
    var camera = new PhotogrammetricCamera(focal, size, point, skew, distos, near, far);
    if (rmax) {
        camera.r2max = rmax * rmax;
    }
    return camera;
}

// https://github.com/micmacIGN/micmac/blob/e0008b7a084f850aa9db4dc50374bd7ec6984da6/src/ori_phot/orilib.cpp#L3069-L3190
function parseConv(xml) {
    var KnownConv = getText(xml, 'KnownConv');
    if (!KnownConv) return undefined;
    var degree = Math.PI / 180;
    var grade = Math.PI / 200;
    var lin = [1, 1, 1];
    var Cardan = true;
    switch (KnownConv) {
        case 'eConvApero_DistM2C' : return { Cardan, lin, Video: true, DistC2M: false, MatrC2M: true, col: [1, 1, 1], scale: degree, order: 'ZYX' };
        case 'eConvApero_DistC2M': return { Cardan, lin, Video: true, DistC2M: true, MatrC2M: true, col: [1, 1, 1], scale: degree, order: 'ZYX' };
        case 'eConvOriLib': return { Cardan, lin, Video: true, DistC2M: false, MatrC2M: true, col: [1, 1, 1], scale: degree, order: 'XYZ' };
        case 'eConvMatrPoivillier_E': return { Cardan, lin, Video: false, DistC2M: false, MatrC2M: false, col: [1, -1, -1], scale: degree, order: 'XYZ' };
        case 'eConvAngErdas' : return { Cardan, lin, Video: true, DistC2M: false, MatrC2M: false, col: [1, -1, -1], scale: degree, order: 'XYZ' };
        case 'eConvAngErdas_Grade': return { Cardan, lin, Video: true, DistC2M: false, MatrC2M: false, col: [1, -1, -1], scale: grade, order: 'XYZ' };
        case 'eConvAngPhotoMDegre': return { Cardan, lin, Video: true, DistC2M: false, MatrC2M: true, col: [1, -1, -1], scale: degree, order: 'XYZ' };
        case 'eConvAngPhotoMGrade': return { Cardan, lin, Video: true, DistC2M: false, MatrC2M: true, col: [1, -1, -1], scale: grade, order: 'XYZ' };
        case 'eConvMatrixInpho': return { Cardan, lin, Video: true, DistC2M: false, MatrC2M: false, col: [1, -1, -1], scale: undefined, order: 'XYZ' };
        case 'eConvAngLPSDegre': return { Cardan, lin, Video: true, DistC2M: false, MatrC2M: true, col: [1, -1, -1], scale: degree, order: 'YXZ' };
        default: throw new Error(`Error parsing micmac orientation : unknown rotation convention : ${KnownConv}`);
    }
}

// https://github.com/micmacIGN/micmac/blob/e0008b7a084f850aa9db4dc50374bd7ec6984da6/src/ori_phot/orilib.cpp#L4127-L4139
// https://github.com/micmacIGN/micmac/blob/bee473615bec715884aaa639642add0812e8c378/src/uti_files/CPP_Ori_txt2Xml.cpp#L1546-L1600
function parseExtrinsics(xml) {
    var conv = xml.getElementsByTagName('ConvOri')[0];
    xml = xml.getElementsByTagName('Externe')[0];
    conv = parseConv(xml) || parseConv(conv);

    var rotation = xml.getElementsByTagName('ParamRotation')[0];
    var encoding = rotation && rotation.children[0] ? rotation.children[0].tagName : 'No or empty ParamRotation tag';
    var M = new Matrix4();
    switch (encoding) {
        case 'CodageMatr':
            var L1 = getNumbers(rotation, 'L1');
            var L2 = getNumbers(rotation, 'L2');
            var L3 = getNumbers(rotation, 'L3');
            M.set(
                L1[0], L1[1], L1[2], 0,
                L2[0], L2[1], L2[2], 0,
                L3[0], L3[1], L3[2], 0,
                0, 0, 0, 1);
            break;

        case 'CodageAngulaire':
            console.warn('CodageAngulaire has never been tested');
            var A = getNumbers(rotation, 'CodageAngulaire').map(x => x * conv.scale);
            var E = new Euler(A[0], A[1], A[2], conv.order);
            M.makeRotationFromEuler(E);
            break;

        default:
            throw new Error(`Error parsing micmac orientation, rotation encoding : ${encoding}`);
    }
    if (!conv.MatrC2M) M.transpose();
    for (var i = 0; i < 3; ++i) {
        for (var j = 0; j < 3; ++j) {
            // it is one or the other (to be checked):
            // M.elements[4*j+i] *= conv.col[i] * conv.lin[j];
            M.elements[4 * j + i] *= conv.col[j] * conv.lin[i];
        }
    }

    M.setPosition(getVector3(xml, 'Centre'));

    // go from photogrammetric convention (X right, Y down, Z front) to js conventions (X right, Y up, Z back)
    M.scale(new Vector3(1, -1, -1));

    return M;
}

function parseView(xml) {
    xml = xml.getElementsByTagName('OrIntImaM2C')[0];
    if (!xml) return null;
    var C = getVector2(xml, 'I00');
    var X = getVector2(xml, 'V10');
    var Y = getVector2(xml, 'V01');
    if (C.x === 0 && C.y === 0 && X.x === 1 && X.y === 0 && Y.x === 0 && Y.y === 1) {
        return null;
    }
    if (X.y !== 0 || Y.x !== 0) {
        console.warn('PhotogrammetricCamera does not support non null values for V01[0] and V10[1]');
    }
    return {
        enabled: true,
        fullWidth: X.x,
        fullHeight: Y.y,
        offsetX: -C.x / X.x,
        offsetY: -C.y / Y.y,
        width: 1,
        height: 1,
    };
}

function parseCheck(xml) {
    xml = xml.getElementsByTagName('Verif')[0];
    if (!xml) return undefined;
    function check(epsilon, N) {
        epsilon = epsilon || this.check.epsilon;
        var array = N ? this.check.points.slice(0, N) : this.check.points;
        return array.reduce((ok, point) => {
            var pp = this.distort(point.p3.clone());
            var d = point.p2.distanceTo(pp);
            if (d > epsilon) {
                ok = false;
                console.warn(point.id, d, pp, point.p2, point.p3);
            }
            return ok;
        }, true);
    }
    check.epsilon = getNumbers(xml, 'Tol')[0];
    check.points = Array.from(xml.getElementsByTagName('Appuis')).map(point => ({
        id: getNumbers(point, 'Num')[0],
        p2: getVector2(point, 'Im'),
        p3: getVector3(point, 'Ter'),
    }));
    return check;
}

function parseOrientation(xml, intrinsics) {
    var camera = parseIntrinsics(intrinsics);

    // camera.view = parseView(xml);
    camera.updateProjectionMatrix();

    camera.matrix = parseExtrinsics(xml);
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
    camera.updateMatrixWorld(true);

    camera.check = parseCheck(xml);
    return camera;
}


export default {
    /** @module MicmacOrientationParser */
    /** Parse an Orientation*.xml from Micmac (see {@link https://github.com/micmacIGN})
     * @function parse
     * @param {string|XMLDocument} xml - the xml content of the orientation file.
     * @param {Source} source - source function ({@link FilesSource}, {@link FetchSource})
     * @return {Promise} - a promise that resolves with a camera.
     *
     */
    parse: function parse(xml, source) {
        if (!(xml instanceof Node)) {
            xml = new window.DOMParser().parseFromString(xml, 'text/xml');
        }
        // sanity check for format
        xml = xml.getElementsByTagName('OrientationConique')[0];
        if (!xml) {
            return undefined;
        }
        var file = getText(xml, 'FileInterne');
        var TypeProj = getText(xml, 'TypeProj');
        if (TypeProj !== 'eProjStenope') {
            var error = new Error(`Error parsing micmac orientation : unknown projection type ${TypeProj}`);
            return Promise.reject(error);
        }

        if (file) {
            return source.read(file, 'text').then(intrinsics => parseOrientation(xml, intrinsics));
        } else {
            var intrinsics = xml.getElementsByTagName('Interne')[0];
            return Promise.resolve(parseOrientation(xml, intrinsics));
        }
    },
    format: 'micmac/orientation',
    extensions: ['xml'],
    mimetypes: ['application/xml'],
    fetchtype: 'xml',
};
