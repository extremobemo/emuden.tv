// renderer_math.cpp
// Column-major 4x4 matrix math and quaternion slerp.

#include "renderer_types.h"

void m4_identity(M4 m) { memset(m,0,64); m[0]=m[5]=m[10]=m[15]=1.f; }

void m4_mul(M4 out, const M4 a, const M4 b) {
    M4 tmp;
    for(int r=0;r<4;r++) for(int c=0;c<4;c++) {
        tmp[c*4+r]=0;
        for(int k=0;k<4;k++) tmp[c*4+r]+=a[k*4+r]*b[c*4+k];
    }
    memcpy(out,tmp,64);
}

void m4_persp(M4 m, float fov, float asp, float n, float f) {
    float t=tanf(fov*.5f); memset(m,0,64);
    m[0]=1.f/(asp*t); m[5]=1.f/t;
    m[10]=(f+n)/(n-f); m[11]=-1.f; m[14]=(2.f*f*n)/(n-f);
}

void m4_lookat(M4 m, float ex,float ey,float ez,
                      float tx,float ty,float tz) {
    float fx=tx-ex, fy=ty-ey, fz=tz-ez;
    float il=1.f/sqrtf(fx*fx+fy*fy+fz*fz);
    fx*=il; fy*=il; fz*=il;
    float rx=fz, ry=0.f, rz=-fx;
    float rl=1.f/sqrtf(rx*rx+ry*ry+rz*rz);
    rx*=rl; ry*=rl; rz*=rl;
    float ux=ry*fz-rz*fy, uy=rz*fx-rx*fz, uz=rx*fy-ry*fx;
    m4_identity(m);
    m[0]=rx; m[4]=ry; m[8] =rz;
    m[1]=ux; m[5]=uy; m[9] =uz;
    m[2]=-fx;m[6]=-fy;m[10]=-fz;
    m[12]=-(rx*ex+ry*ey+rz*ez);
    m[13]=-(ux*ex+uy*ey+uz*ez);
    m[14]= (fx*ex+fy*ey+fz*ez);
}

void m4_from_trs(M4 out, const float t[3], const float r[4], const float s[3]) {
    float x=r[0],y=r[1],z=r[2],w=r[3];
    float x2=x+x,y2=y+y,z2=z+z;
    float xx=x*x2,xy=x*y2,xz=x*z2;
    float yy=y*y2,yz=y*z2,zz=z*z2;
    float wx=w*x2,wy=w*y2,wz=w*z2;
    out[0]=(1-(yy+zz))*s[0]; out[1]=(xy+wz)*s[0];  out[2]=(xz-wy)*s[0];  out[3]=0.f;
    out[4]=(xy-wz)*s[1];     out[5]=(1-(xx+zz))*s[1]; out[6]=(yz+wx)*s[1]; out[7]=0.f;
    out[8]=(xz+wy)*s[2];     out[9]=(yz-wx)*s[2];  out[10]=(1-(xx+yy))*s[2]; out[11]=0.f;
    out[12]=t[0]; out[13]=t[1]; out[14]=t[2]; out[15]=1.f;
}

void q_slerp(float* out, const float* a, const float* b, float t) {
    float dot = a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];
    float b2[4]={b[0],b[1],b[2],b[3]};
    if (dot < 0.f) { dot=-dot; b2[0]=-b2[0];b2[1]=-b2[1];b2[2]=-b2[2];b2[3]=-b2[3]; }
    if (dot > 0.9995f) {
        for(int i=0;i<4;i++) out[i]=a[i]+(b2[i]-a[i])*t;
        float l=sqrtf(out[0]*out[0]+out[1]*out[1]+out[2]*out[2]+out[3]*out[3]);
        for(int i=0;i<4;i++) out[i]/=l;
        return;
    }
    float th0=acosf(dot), th=th0*t;
    float s0=sinf(th)/sinf(th0), sa=cosf(th)-dot*s0;
    for(int i=0;i<4;i++) out[i]=sa*a[i]+s0*b2[i];
}
