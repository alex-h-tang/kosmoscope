export function jdUTC(date = new Date()) {
  return date.getTime() / 86400000 + 2440587.5;
}
export function centuriesTT(jd_utc) {
  const deltaT = 69;
  const jd_tt = jd_utc + deltaT / 86400;
  return (jd_tt - 2451545.0) / 36525;
}
export function meanObliquityRad(T) {
  const a =
    84381.406 - 46.836769*T - 0.0001831*T*T + 0.00200340*T*T*T
    - 5.76e-7*T**4 - 4.34e-8*T**5;
  return (a / 3600) * Math.PI / 180;
}
export function gmstRad(jd) {
  const Tu = (jd - 2451545.0) / 36525.0;
  let gmst_sec =
    67310.54841 + (876600*3600 + 8640184.812866)*Tu + 0.093104*Tu*Tu - 6.2e-6*Tu**3;
  gmst_sec = ((gmst_sec % 86400) + 86400) % 86400;
  return (gmst_sec / 240) * Math.PI / 180;
}

export function sunEci(T) {
  const d2r = Math.PI/180;
  const g = (357.52911 + 35999.05029*T - 0.0001537*T*T) * d2r;
  const L = (280.46646 + 36000.76983*T + 0.0003032*T*T) * d2r;
  const lambda = ( (L/d2r)
    + (1.914602 - 0.004817*T - 0.000014*T*T)*Math.sin(g)
    + (0.019993 - 0.000101*T)*Math.sin(2*g)
    + 0.000289*Math.sin(3*g) ) * d2r;
  const R = 1.000001018 - 0.016708617*Math.cos(g) - 0.000139589*Math.cos(2*g);
  const eps = meanObliquityRad(T);
  return {
    x: R * Math.cos(lambda),
    y: R * Math.sin(lambda) * Math.cos(eps),
    z: R * Math.sin(lambda) * Math.sin(eps),
    R_AU: R
  };
}

export function moonEci(T) {
  const d2r = Math.PI/180;
  const Lp = 218.3164477 + 481267.88123421*T - 0.0015786*T*T + T*T*T/538841 - T*T*T*T/65194000;
  const D  = 297.8501921 + 445267.1114034*T - 0.0018819*T*T + T*T*T/545868 - T*T*T*T/113065000;
  const M  = 357.5291092 + 35999.0502909*T - 0.0001536*T*T + T*T*T/24490000;
  const Mp = 134.9633964 + 477198.8675055*T + 0.0087414*T*T + T*T*T/69699 - T*T*T*T/14712000;
  const F  = 93.2720950 + 483202.0175233*T - 0.0036539*T*T - T*T*T/3526000 + T*T*T*T/863310000;

  const Lp_r = Lp*d2r, D_r = D*d2r, Mp_r = Mp*d2r, F_r = F*d2r;
  const lon = (Lp + 6.289*Math.sin(Mp_r) + 1.274*Math.sin(2*D_r - Mp_r)
    + 0.658*Math.sin(2*D_r) + 0.214*Math.sin(2*Mp_r) + 0.110*Math.sin(D_r)) * d2r;
  const lat = (5.128*Math.sin(F_r) + 0.280*Math.sin(Mp_r + F_r) + 0.277*Math.sin(Mp_r - F_r)
    + 0.173*Math.sin(2*D_r - F_r) + 0.055*Math.sin(2*D_r + F_r)
    + 0.046*Math.sin(2*D_r - Mp_r + F_r)) * d2r;

  const delta_km = 385000.56 - 20905.355*Math.cos(Mp_r) - 3699.111*Math.cos(2*D_r - Mp_r)
    - 2955.968*Math.cos(2*D_r) - 569.925*Math.cos(2*Mp_r);
  const r_AU = delta_km / 149597870.7;

  const xe = r_AU * Math.cos(lat) * Math.cos(lon);
  const ye = r_AU * Math.cos(lat) * Math.sin(lon);
  const ze = r_AU * Math.sin(lat);
  const eps = meanObliquityRad(T);
  return { x: xe, y: ye*Math.cos(eps) - ze*Math.sin(eps), z: ye*Math.sin(eps) + ze*Math.cos(eps), r_AU };
}

export function precessionMatrix(T) {
  const as2r = Math.PI / (180*3600);
  const zetaA  = (2306.2181*T + 0.30188*T*T + 0.017998*T*T*T) * as2r;
  const zA     = (2306.2181*T + 1.09468*T*T + 0.018203*T*T*T) * as2r;
  const thetaA = (2004.3109*T - 0.42665*T*T - 0.041833*T*T*T) * as2r;

  const cz = Math.cos(zA), sz = Math.sin(zA);
  const ct = Math.cos(thetaA), st = Math.sin(thetaA);
  const cp = Math.cos(zetaA), sp = Math.sin(zetaA);

  const m1 = [ [ cz,  sz, 0], [ -sz,  cz, 0], [ 0, 0, 1] ];
  const m2 = [ [ 1,   0,  0], [  0,  ct, st], [ 0,-st, ct] ];
  const m3 = [ [ cp,  sp, 0], [ -sp, cp, 0], [ 0, 0, 1] ];
  const mul = (A,B)=>A.map((r,i)=>r.map((_,j)=>A[i][0]*B[0][j]+A[i][1]*B[1][j]+A[i][2]*B[2][j]));
  return mul(mul(m1,m2),m3);
}
export function applyMat3(m, v) {
  return { x: m[0][0]*v.x + m[0][1]*v.y + m[0][2]*v.z,
           y: m[1][0]*v.x + m[1][1]*v.y + m[1][2]*v.z,
           z: m[2][0]*v.x + m[2][1]*v.y + m[2][2]*v.z };
}
