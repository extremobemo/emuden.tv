// renderer_anim.cpp
// Skeletal animation evaluation: samples glTF animation channels at a given time
// and computes per-bone matrices ready for the skinned mesh shader.

#include "renderer_types.h"

void update_anim(AvatarModel* mdl, int anim_idx, float anim_time) {
    if (mdl->anims.empty() || anim_idx < 0 || anim_idx >= (int)mdl->anims.size()) return;
    CatAnim& anim = mdl->anims[anim_idx];

    // Reset to default pose
    for (int ni=0;ni<mdl->node_count;ni++){
        memcpy(g_anim.node_t[ni],mdl->node_def_t[ni],12);
        memcpy(g_anim.node_r[ni],mdl->node_def_r[ni],16);
        memcpy(g_anim.node_s[ni],mdl->node_def_s[ni],12);
    }

    // Sample channels
    for (const CatChannel& ch : anim.channels) {
        int n=ch.node; if(n<0||n>=mdl->node_count) continue;
        int kc=(int)ch.times.size(); if(kc==0) continue;
        auto it = std::upper_bound(ch.times.begin(), ch.times.end(), anim_time);
        int lo = (int)(it - ch.times.begin()) - 1;
        if (lo < 0) lo = 0;
        int hi=(lo+1<kc)?lo+1:lo;
        float t=0.f;
        if(hi!=lo) t=(anim_time-ch.times[lo])/(ch.times[hi]-ch.times[lo]);
        if(t<0.f)t=0.f; if(t>1.f)t=1.f;
        if(ch.path==0){
            const float*a=&ch.values[lo*3],*b=&ch.values[hi*3];
            g_anim.node_t[n][0]=a[0]+(b[0]-a[0])*t;
            g_anim.node_t[n][1]=a[1]+(b[1]-a[1])*t;
            g_anim.node_t[n][2]=a[2]+(b[2]-a[2])*t;
        } else if(ch.path==1){
            q_slerp(g_anim.node_r[n],&ch.values[lo*4],&ch.values[hi*4],t);
        } else {
            const float*a=&ch.values[lo*3],*b=&ch.values[hi*3];
            g_anim.node_s[n][0]=a[0]+(b[0]-a[0])*t;
            g_anim.node_s[n][1]=a[1]+(b[1]-a[1])*t;
            g_anim.node_s[n][2]=a[2]+(b[2]-a[2])*t;
        }
    }

    // Compute global transforms
    bool done[MAX_NODES]={};
    int left=mdl->node_count;
    while(left>0){
        int prev=left;
        for(int ni=0;ni<mdl->node_count;ni++){
            if(done[ni]) continue;
            int p=mdl->node_parent[ni];
            if(p>=0&&!done[p]) continue;
            M4 local; m4_from_trs(local,g_anim.node_t[ni],g_anim.node_r[ni],g_anim.node_s[ni]);
            if(p<0) memcpy(g_anim.node_global[ni],local,64);
            else    m4_mul(g_anim.node_global[ni],g_anim.node_global[p],local);
            done[ni]=true; left--;
        }
        if(left==prev) break;
    }

    // Compute bone matrices = global[joint] * inv_bind[j]
    for(int j=0;j<mdl->joint_count;j++){
        M4 bone; m4_mul(bone, g_anim.node_global[mdl->joint_nodes[j]], mdl->inv_bind[j]);
        memcpy(g_anim.bone_mats[j],bone,64);
    }
}
