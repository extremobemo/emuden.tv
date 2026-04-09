// renderer_render.cpp
// Player movement, static scene rendering, skinned avatar rendering,
// character preview mode, and the main per-frame render orchestration.

#include "renderer_types.h"

void update_player() {
    const float speed = PLAYER_SPEED;
    float fw_x = sinf(g_local.yaw);
    float fw_z = cosf(g_local.yaw);
    float rt_x = cosf(g_local.yaw);
    float rt_z = -sinf(g_local.yaw);

    if (g_move[0]) { g_local.x += fw_x*speed; g_local.z += fw_z*speed; } // W
    if (g_move[1]) { g_local.x -= fw_x*speed; g_local.z -= fw_z*speed; } // S
    if (g_move[2]) { g_local.x -= rt_x*speed; g_local.z -= rt_z*speed; } // A
    if (g_move[3]) { g_local.x += rt_x*speed; g_local.z += rt_z*speed; } // D
}

// ── Static geometry pass (TV body + room models) ──────────────────────────────
void render_scene(const M4 vp, const float scaled_col[4][3], const float cone_dir[3]) {
    glUseProgram(g_prog);
    glUniform1i(g_u_tex, 0);
    glUniform2f(g_u_overscan, g_scene.overscan_x, g_scene.overscan_y);
    glUniform3fv(g_u_tv_quad_pos, 4, &g_light.quad_pos[0][0]);
    glUniform3fv(g_u_tv_quad_col, 4, &scaled_col[0][0]);
    glUniform3fv(g_u_tv_normal,   1, cone_dir);
    glUniform1f (g_u_cone_power,  g_light.cone_power);
    glUniform3fv(g_u_lamp_pos,       1, g_light.lamp_pos);
    glUniform1f (g_u_lamp_intensity, g_light.lamp_intensity);

    M4 room_parent;
    {
        float s = g_scene.room_scale;
        float c = cosf(g_scene.room_rot_y), sr = sinf(g_scene.room_rot_y);
        room_parent[0] = s*c;  room_parent[1] = 0.f; room_parent[2] =-s*sr; room_parent[3] = 0.f;
        room_parent[4] = 0.f;  room_parent[5] = s;   room_parent[6] = 0.f;  room_parent[7] = 0.f;
        room_parent[8] = s*sr; room_parent[9] = 0.f; room_parent[10]= s*c;  room_parent[11]= 0.f;
        room_parent[12]= g_scene.room_tx; room_parent[13]= g_scene.room_ty;
        room_parent[14]= g_scene.room_tz; room_parent[15]= 1.f;
    }

    for (auto& p : g_prims) {
        M4 world, mvp;
        if (p.is_room) { m4_mul(world, room_parent, p.world); }
        else           { memcpy(world, p.world, sizeof(M4)); }
        m4_mul(mvp, vp, world);
        glUniformMatrix4fv(g_u_mvp,   1, GL_FALSE, mvp);
        glUniformMatrix4fv(g_u_model, 1, GL_FALSE, world);
        glUniform1f(g_u_screen, p.is_screen ? 1.f : 0.f);

        glActiveTexture(GL_TEXTURE0);
        GLuint tex = p.is_screen ? g_crt_tex : (p.base_tex ? p.base_tex : g_white_tex);
        glBindTexture(GL_TEXTURE_2D, tex);

        glBindBuffer(GL_ARRAY_BUFFER, p.vbo);
        glEnableVertexAttribArray(g_a_pos);
        glVertexAttribPointer(g_a_pos,  3,GL_FLOAT,GL_FALSE,32,(void*)0);
        glEnableVertexAttribArray(g_a_uv);
        glVertexAttribPointer(g_a_uv,   2,GL_FLOAT,GL_FALSE,32,(void*)12);
        if (g_a_norm>=0) {
            glEnableVertexAttribArray(g_a_norm);
            glVertexAttribPointer(g_a_norm,3,GL_FLOAT,GL_FALSE,32,(void*)20);
        }

        if (p.double_sided) glDisable(GL_CULL_FACE);
        glDrawArrays(GL_TRIANGLES, 0, p.vcount);
        if (p.double_sided) glEnable(GL_CULL_FACE);
    }
}

// ── Skinned remote player avatars ────────────────────────────────────────────
void render_avatars(const M4 vp, const M4 view, const float scaled_col[4][3], const float cone_dir[3]) {
    if (!g_skin_prog) return;

    glUseProgram(g_skin_prog);
    glUniform1i(g_skin_u_tex, 0);
    glActiveTexture(GL_TEXTURE0);
    glUniform3fv(g_skin_u_tv_quad_pos, 4, &g_light.quad_pos[0][0]);
    glUniform3fv(g_skin_u_tv_quad_col, 4, &scaled_col[0][0]);
    glUniform3fv(g_skin_u_tv_normal,   1, cone_dir);
    glUniform1f (g_skin_u_cone_power,  g_light.cone_power);
    glUniform3fv(g_skin_u_lamp_pos, 1, g_light.lamp_pos);
    glUniform1f (g_skin_u_lamp_intensity, g_light.lamp_intensity);
    glUniform1f (g_skin_u_flat_shade, 0.f);

    glDisable(GL_CULL_FACE);

    if(g_skin_a_pos>=0)    glEnableVertexAttribArray(g_skin_a_pos);
    if(g_skin_a_uv>=0)     glEnableVertexAttribArray(g_skin_a_uv);
    if(g_skin_a_norm>=0)   glEnableVertexAttribArray(g_skin_a_norm);
    if(g_skin_a_joints>=0) glEnableVertexAttribArray(g_skin_a_joints);
    if(g_skin_a_weights>=0)glEnableVertexAttribArray(g_skin_a_weights);

    for (int i=0; i<MAX_REMOTE; i++) {
        if (!g_remote[i].active) continue;
        AvatarModel* mdl = &g_models[g_remote[i].model_idx];
        if (!mdl->loaded || !mdl->vbo || mdl->meshes.empty()) continue;

        int target = g_remote[i].moving ? mdl->walk_anim : mdl->idle_anim;
        if (g_remote[i].anim_idx != target) {
            g_remote[i].anim_idx  = target;
            g_remote[i].anim_time = 0.f;
        }
        if (g_remote[i].anim_idx < (int)mdl->anims.size()) {
            float dur = mdl->anims[g_remote[i].anim_idx].duration;
            if (dur > 0.f) g_remote[i].anim_time = fmodf(g_remote[i].anim_time + 1.f/60.f, dur);
        }
        update_anim(mdl, g_remote[i].anim_idx, g_remote[i].anim_time);

        glUniformMatrix4fv(g_skin_u_vp, 1, GL_FALSE, vp);
        if (mdl->joint_count > 0)
            glUniformMatrix4fv(g_skin_u_bones, mdl->joint_count, GL_FALSE, &g_anim.bone_mats[0][0]);

        float c=cosf(g_remote[i].yaw), s=sinf(g_remote[i].yaw);
        float sc = AVATAR_SCALE * (g_remote[i].model_idx == 1 ? 1.75f :
                                   g_remote[i].model_idx == 2 ? 60.0f :
                                   g_remote[i].model_idx == 3 ? 1.0f  : 1.0f);
        M4 world;
        world[0]=c*sc; world[1]=0.f;  world[2]=-s*sc; world[3]=0.f;
        world[4]=0.f;  world[5]=-sc;  world[6]=0.f;   world[7]=0.f;
        world[8]=s*sc; world[9]=0.f;  world[10]=c*sc; world[11]=0.f;
        world[12]=g_remote[i].x; world[13]=g_remote[i].y; world[14]=g_remote[i].z; world[15]=1.f;
        glUniformMatrix4fv(g_skin_u_world, 1, GL_FALSE, world);

        glBindBuffer(GL_ARRAY_BUFFER, mdl->vbo);
        if(g_skin_a_pos>=0)    glVertexAttribPointer(g_skin_a_pos,    3,GL_FLOAT,GL_FALSE,64,(void*)0);
        if(g_skin_a_uv>=0)     glVertexAttribPointer(g_skin_a_uv,     2,GL_FLOAT,GL_FALSE,64,(void*)12);
        if(g_skin_a_norm>=0)   glVertexAttribPointer(g_skin_a_norm,   3,GL_FLOAT,GL_FALSE,64,(void*)20);
        if(g_skin_a_joints>=0) glVertexAttribPointer(g_skin_a_joints, 4,GL_FLOAT,GL_FALSE,64,(void*)32);
        if(g_skin_a_weights>=0)glVertexAttribPointer(g_skin_a_weights,4,GL_FLOAT,GL_FALSE,64,(void*)48);

        for (const auto& am : mdl->meshes) {
            glBindTexture(GL_TEXTURE_2D, am.tex);
            glDrawArrays(GL_TRIANGLES, am.start, am.count);
        }
    }

    if(g_skin_a_pos>=0)    glDisableVertexAttribArray(g_skin_a_pos);
    if(g_skin_a_uv>=0)     glDisableVertexAttribArray(g_skin_a_uv);
    if(g_skin_a_norm>=0)   glDisableVertexAttribArray(g_skin_a_norm);
    if(g_skin_a_joints>=0) glDisableVertexAttribArray(g_skin_a_joints);
    if(g_skin_a_weights>=0)glDisableVertexAttribArray(g_skin_a_weights);

    // Render nameplates as camera-facing billboards above each active player
    if (g_bill_prog) {
        float cam_right[3] = { view[0], view[4], view[8]  };
        float cam_up[3]    = { view[1], view[5], view[9]  };

        glUseProgram(g_bill_prog);
        glEnable(GL_BLEND);
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
        glDepthMask(GL_FALSE);
        glUniformMatrix4fv(g_bill_u_vp,        1, GL_FALSE, vp);
        glUniform3fv      (g_bill_u_cam_right,  1, cam_right);
        glUniform3fv      (g_bill_u_cam_up,     1, cam_up);

        glBindBuffer(GL_ARRAY_BUFFER, g_bill_vbo);
        glEnableVertexAttribArray(g_bill_a_corner);
        glVertexAttribPointer(g_bill_a_corner, 2, GL_FLOAT, GL_FALSE, 0, 0);

        for (int i = 0; i < MAX_REMOTE; i++) {
            if (!g_remote[i].active || !g_remote[i].name_tex) continue;
            float hw = 15.f;
            float hh = (g_remote[i].name_h > 0)
                     ? hw * (float)g_remote[i].name_h / (float)g_remote[i].name_w
                     : hw * 0.25f;
            glUniform3f(g_bill_u_center, g_remote[i].x, g_remote[i].y - 50.f, g_remote[i].z);
            glUniform1f(g_bill_u_hw, hw);
            glUniform1f(g_bill_u_hh, hh);
            glActiveTexture(GL_TEXTURE0);
            glBindTexture(GL_TEXTURE_2D, g_remote[i].name_tex);
            glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        }

        glDisableVertexAttribArray(g_bill_a_corner);
        glDepthMask(GL_TRUE);
        glDisable(GL_BLEND);
    }

    glEnable(GL_CULL_FACE);
}

void render_preview() {
    glViewport(0, 0, g_scene.canvas_w, g_scene.canvas_h);
    glClearColor(0.102f, 0.102f, 0.102f, 1.f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    AvatarModel* mdl = &g_models[g_preview_model];
    if (!mdl->loaded || !mdl->vbo || mdl->anims.empty()) return;

    int ia = mdl->idle_anim;
    if (ia >= 0 && ia < (int)mdl->anims.size()) {
        float dur = mdl->anims[ia].duration;
        if (dur > 0.f) g_preview_anim_t = fmodf(g_preview_anim_t + 1.f/60.f, dur);
        update_anim(mdl, ia, g_preview_anim_t);
    }

    const PreviewXform& xf = g_preview_xform[g_preview_model];
    float base_dist = (g_preview_model == 2) ? 900.f :
                      (g_preview_model == 1) ?  40.f : 40.f;
    float dist = base_dist / (xf.scale > 0.f ? xf.scale : 1.f);

    M4 proj, view, vp;
    float aspect = (float)g_scene.canvas_w / (float)g_scene.canvas_h;
    m4_persp(proj, 1.6f, aspect, 0.5f, 10000.f);
    m4_lookat(view, 0.f, 0.f, dist, 0.f, 0.f, 0.f);
    m4_mul(vp, proj, view);

    glUseProgram(g_skin_prog);
    glUniform1i (g_skin_u_tex, 0); glActiveTexture(GL_TEXTURE0);
    glUniform1f (g_skin_u_flat_shade, 1.0f);
    glUniformMatrix4fv(g_skin_u_vp, 1, GL_FALSE, vp);
    if (mdl->joint_count > 0)
        glUniformMatrix4fv(g_skin_u_bones, mdl->joint_count, GL_FALSE, &g_anim.bone_mats[0][0]);

    g_preview_spin += 0.008f;
    if (g_preview_spin > 6.2832f) g_preview_spin -= 6.2832f;
    float ca = cosf(g_preview_spin), sa = sinf(g_preview_spin);

    float sc = AVATAR_SCALE * xf.scale * (g_preview_model == 1 ? 1.75f :
                                          g_preview_model == 2 ? 60.0f :
                                          g_preview_model == 3 ? 1.0f  : 1.0f);
    M4 world = {sc*ca,0,-sc*sa,0, 0,-sc,0,0, sc*sa,0,sc*ca,0, xf.x,xf.y,xf.z,1};
    glUniformMatrix4fv(g_skin_u_world, 1, GL_FALSE, world);

    glDisable(GL_CULL_FACE);
    if(g_skin_a_pos>=0)    glEnableVertexAttribArray(g_skin_a_pos);
    if(g_skin_a_uv>=0)     glEnableVertexAttribArray(g_skin_a_uv);
    if(g_skin_a_norm>=0)   glEnableVertexAttribArray(g_skin_a_norm);
    if(g_skin_a_joints>=0) glEnableVertexAttribArray(g_skin_a_joints);
    if(g_skin_a_weights>=0)glEnableVertexAttribArray(g_skin_a_weights);

    glBindBuffer(GL_ARRAY_BUFFER, mdl->vbo);
    if(g_skin_a_pos>=0)    glVertexAttribPointer(g_skin_a_pos,    3,GL_FLOAT,GL_FALSE,64,(void*)0);
    if(g_skin_a_uv>=0)     glVertexAttribPointer(g_skin_a_uv,     2,GL_FLOAT,GL_FALSE,64,(void*)12);
    if(g_skin_a_norm>=0)   glVertexAttribPointer(g_skin_a_norm,   3,GL_FLOAT,GL_FALSE,64,(void*)20);
    if(g_skin_a_joints>=0) glVertexAttribPointer(g_skin_a_joints, 4,GL_FLOAT,GL_FALSE,64,(void*)32);
    if(g_skin_a_weights>=0)glVertexAttribPointer(g_skin_a_weights,4,GL_FLOAT,GL_FALSE,64,(void*)48);

    for (const auto& am : mdl->meshes) {
        glBindTexture(GL_TEXTURE_2D, am.tex);
        glDrawArrays(GL_TRIANGLES, am.start, am.count);
    }

    if(g_skin_a_pos>=0)    glDisableVertexAttribArray(g_skin_a_pos);
    if(g_skin_a_uv>=0)     glDisableVertexAttribArray(g_skin_a_uv);
    if(g_skin_a_norm>=0)   glDisableVertexAttribArray(g_skin_a_norm);
    if(g_skin_a_joints>=0) glDisableVertexAttribArray(g_skin_a_joints);
    if(g_skin_a_weights>=0)glDisableVertexAttribArray(g_skin_a_weights);
    glEnable(GL_CULL_FACE);
}

void render() {
    if (g_preview_active) { render_preview(); return; }

    glViewport(0, 0, g_scene.canvas_w, g_scene.canvas_h);
    glClearColor(0.35f,0.35f,0.35f,1.f);
    glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);

    float eye_y = g_local.y + g_cat_eye_height;
    float tx = g_local.x + cosf(g_local.pitch) * sinf(g_local.yaw);
    float ty = eye_y + sinf(g_local.pitch);
    float tz = g_local.z + cosf(g_local.pitch) * cosf(g_local.yaw);

    M4 proj, view, vp;
    m4_persp(proj, 1.0f, (float)g_scene.canvas_w / g_scene.canvas_h, 0.5f, 1000.f);
    m4_lookat(view, g_local.x, eye_y, g_local.z, tx, ty, tz);
    m4_mul(vp, proj, view);

    float scaled_col[4][3];
    for (int q=0;q<4;q++) for (int k=0;k<3;k++)
        scaled_col[q][k] = g_light.quad_col[q][k] * g_light.tv_intensity;
    float yaw_r   = g_light.cone_yaw   * 3.14159265f / 180.f;
    float pitch_r = g_light.cone_pitch * 3.14159265f / 180.f;
    float cy=cosf(yaw_r), sy=sinf(yaw_r);
    float bn0=g_light.screen_normal[0], bn1=g_light.screen_normal[1], bn2=g_light.screen_normal[2];
    float n0= cy*bn0 + sy*bn2, n1=bn1, n2=-sy*bn0 + cy*bn2;
    float cp=cosf(pitch_r), sp=sinf(pitch_r);
    float cone_dir[3] = { n0, cp*n1 - sp*n2, sp*n1 + cp*n2 };

    render_scene(vp, scaled_col, cone_dir);
    render_avatars(vp, view, scaled_col, cone_dir);

    // Debug cube — audio source visualiser
    if (g_debug_visible && g_flat_prog && g_cube_vbo) {
        M4 model, mvp;
        m4_identity(model);
        model[12] = g_debug_pos[0];
        model[13] = g_debug_pos[1];
        model[14] = g_debug_pos[2];
        m4_mul(mvp, vp, model);
        glUseProgram(g_flat_prog);
        glUniformMatrix4fv(g_flat_u_mvp, 1, GL_FALSE, mvp);
        glUniform3f(g_flat_u_color, 1.f, 0.85f, 0.f);
        glBindBuffer(GL_ARRAY_BUFFER, g_cube_vbo);
        glEnableVertexAttribArray(g_flat_a_pos);
        glVertexAttribPointer(g_flat_a_pos, 3, GL_FLOAT, GL_FALSE, 0, 0);
        glDisable(GL_DEPTH_TEST);
        glDrawArrays(GL_LINES, 0, 24);
        glEnable(GL_DEPTH_TEST);
        glDisableVertexAttribArray(g_flat_a_pos);
    }
}
