// renderer_scene.cpp
// glTF scene loaders: TV model, room model, and skinned avatar models.

#define CGLTF_IMPLEMENTATION
#include "renderer_types.h"
#include "renderer_shaders.h"  // SKIN_VS, SKIN_FS used in load_avatar

void load_tv() {
    cgltf_options opts = {};
    cgltf_data* gltf = nullptr;
    cgltf_result r = cgltf_parse_file(&opts, "/tv/CRT_TV.gltf", &gltf);
    if (r != cgltf_result_success) { printf("cgltf parse failed: %d\n",r); return; }
    r = cgltf_load_buffers(&opts, gltf, "/tv/CRT_TV.gltf");
    if (r != cgltf_result_success) { printf("cgltf load_buffers failed: %d\n",r); return; }

    for (cgltf_size ni=0; ni<gltf->nodes_count; ni++) {
        cgltf_node* node=&gltf->nodes[ni];
        if (!node->mesh) continue;

        M4 world;
        cgltf_node_transform_world(node, world);
        // USDZ conversion leaves model upside-down — apply Y-flip correction
        world[1] = -world[1]; world[5] = -world[5];
        world[9] = -world[9]; world[13] = -world[13];

        for (cgltf_size pi=0; pi<node->mesh->primitives_count; pi++) {
            cgltf_primitive* prim=&node->mesh->primitives[pi];
            if (prim->type != cgltf_primitive_type_triangles) continue;

            cgltf_accessor *pos_acc=nullptr, *uv_acc=nullptr, *norm_acc=nullptr;
            for (cgltf_size ai=0; ai<prim->attributes_count; ai++) {
                auto& attr=prim->attributes[ai];
                if (attr.type==cgltf_attribute_type_position)  pos_acc=attr.data;
                if (attr.type==cgltf_attribute_type_texcoord && attr.index==0) uv_acc=attr.data;
                if (attr.type==cgltf_attribute_type_normal)    norm_acc=attr.data;
            }
            if (!pos_acc) continue;

            cgltf_buffer_view* bv = pos_acc->buffer_view;
            const uint8_t* bv_data = (const uint8_t*)bv->buffer->data + bv->offset;

            GLuint vbo; glGenBuffers(1,&vbo);
            glBindBuffer(GL_ARRAY_BUFFER,vbo);
            glBufferData(GL_ARRAY_BUFFER, bv->size, bv_data, GL_STATIC_DRAW);

            bool is_screen = false;
            GLuint base_tex = 0;
            if (prim->material && prim->material->name) {
                is_screen = (strcmp(prim->material->name,"TVScreen")==0);
                if (!is_screen) {
                    auto& pbr = prim->material->pbr_metallic_roughness;
                    if (pbr.base_color_texture.texture && pbr.base_color_texture.texture->image) {
                        const char* uri = pbr.base_color_texture.texture->image->uri;
                        char path[256];
                        snprintf(path,sizeof(path),"/tv/%s",uri);
                        base_tex = load_tex(path);
                    }
                }
            }

            if (is_screen && pos_acc) {
                float mn_x=1e9f,mx_x=-1e9f,mn_y=1e9f,mx_y=-1e9f;
                for (size_t vi=0; vi<pos_acc->count; vi++) {
                    float p[3]; cgltf_accessor_read_float(pos_acc,vi,p,3);
                    if(p[0]<mn_x)mn_x=p[0]; if(p[0]>mx_x)mx_x=p[0];
                    if(p[1]<mn_y)mn_y=p[1]; if(p[1]>mx_y)mx_y=p[1];
                }
                g_light.half_x = (mx_x-mn_x)*0.5f;
                g_light.half_y = (mx_y-mn_y)*0.5f;
                printf("Screen local half-extents: %.3f x %.3f\n", g_light.half_x, g_light.half_y);
            }

            TvPrim tp;
            tp.vbo          = vbo;
            tp.vcount       = (int)pos_acc->count;
            tp.base_tex     = base_tex;
            tp.is_screen    = is_screen;
            tp.double_sided = false;
            tp.is_room      = false;
            memcpy(tp.world, world, sizeof(M4));
            g_prims.push_back(tp);
        }
    }
    printf("Loaded %zu TV primitives\n", g_prims.size());
    cgltf_free(gltf);
}

void load_room() {
    cgltf_options opts = {};
    cgltf_data* gltf = nullptr;
    cgltf_result r = cgltf_parse_file(&opts, "/tv/crt_room_full.gltf", &gltf);
    if (r != cgltf_result_success) { printf("crt_room_full.gltf parse failed: %d\n",r); return; }
    r = cgltf_load_buffers(&opts, gltf, "/tv/crt_room_full.gltf");
    if (r != cgltf_result_success) { printf("room.gltf load_buffers failed: %d\n",r); return; }

    std::vector<GLuint> tex_cache(gltf->images_count, 0);
    auto get_tex = [&](cgltf_image* img) -> GLuint {
        int idx = (int)(img - gltf->images);
        if (tex_cache[idx]) return tex_cache[idx];
        GLuint t = img->buffer_view ? load_tex_bv(img->buffer_view) : 0;
        if (!t && img->uri) {
            char path[256]; snprintf(path,sizeof(path),"/tv/%s",img->uri);
            t = load_tex(path);
        }
        tex_cache[idx] = t;
        return t;
    };

    for (cgltf_size ni = 0; ni < gltf->nodes_count; ni++) {
        cgltf_node* node = &gltf->nodes[ni];
        if (!node->mesh) continue;

        M4 world;
        cgltf_node_transform_world(node, world);
        world[1]=-world[1]; world[5]=-world[5]; world[9]=-world[9]; world[13]=-world[13];

        for (cgltf_size pi = 0; pi < node->mesh->primitives_count; pi++) {
            cgltf_primitive* prim = &node->mesh->primitives[pi];
            if (prim->type != cgltf_primitive_type_triangles || !prim->indices) continue;

            cgltf_accessor *pos_acc=nullptr, *uv_acc=nullptr, *norm_acc=nullptr;
            for (cgltf_size ai=0; ai<prim->attributes_count; ai++) {
                auto& a = prim->attributes[ai];
                if (a.type==cgltf_attribute_type_position) pos_acc=a.data;
                if (a.type==cgltf_attribute_type_texcoord && a.index==0) uv_acc=a.data;
                if (a.type==cgltf_attribute_type_normal)   norm_acc=a.data;
            }
            if (!pos_acc) continue;

            size_t idx_count = prim->indices->count;
            std::vector<float> vdata;
            vdata.reserve(idx_count * 8);
            for (size_t i = 0; i < idx_count; i++) {
                unsigned int idx = 0;
                cgltf_accessor_read_uint(prim->indices, i, &idx, 1);
                float p[3]={0,0,0}, u[2]={0,0}, n[3]={0,1,0};
                cgltf_accessor_read_float(pos_acc, idx, p, 3);
                if (uv_acc)   cgltf_accessor_read_float(uv_acc,   idx, u, 2);
                if (norm_acc) cgltf_accessor_read_float(norm_acc, idx, n, 3);
                vdata.insert(vdata.end(), {p[0],p[1],p[2], u[0],u[1], n[0],n[1],n[2]});
            }

            GLuint vbo; glGenBuffers(1,&vbo);
            glBindBuffer(GL_ARRAY_BUFFER,vbo);
            glBufferData(GL_ARRAY_BUFFER,(GLsizeiptr)(vdata.size()*4),vdata.data(),GL_STATIC_DRAW);

            GLuint base_tex = 0;
            if (prim->material) {
                auto& pbr = prim->material->pbr_metallic_roughness;
                if (pbr.base_color_texture.texture && pbr.base_color_texture.texture->image) {
                    base_tex = get_tex(pbr.base_color_texture.texture->image);
                } else {
                    float* cf = pbr.base_color_factor;
                    uint8_t col[4]={(uint8_t)(cf[0]*255),(uint8_t)(cf[1]*255),
                                    (uint8_t)(cf[2]*255),255};
                    glGenTextures(1,&base_tex);
                    glBindTexture(GL_TEXTURE_2D,base_tex);
                    glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,1,1,0,GL_RGBA,GL_UNSIGNED_BYTE,col);
                    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);
                    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
                }
            }

            TvPrim tp;
            tp.vbo         = vbo;
            tp.vcount      = (int)idx_count;
            tp.base_tex    = base_tex;
            tp.is_screen   = false;
            tp.double_sided = prim->material && prim->material->double_sided;
            tp.is_room     = true;
            memcpy(tp.world, world, sizeof(M4));
            g_prims.push_back(tp);
        }
    }
    if (gltf->accessors_count > 0) {
        for (cgltf_size i = 0; i < gltf->accessors_count; i++) {
            cgltf_accessor* a = &gltf->accessors[i];
            if (a->type == cgltf_type_vec3 && a->has_min && a->has_max) {
                printf("Room VEC3 bounds: min(%.2f %.2f %.2f) max(%.2f %.2f %.2f)\n",
                    a->min[0],a->min[1],a->min[2], a->max[0],a->max[1],a->max[2]);
                break;
            }
        }
    }
    printf("Room loaded, total prims: %zu\n", g_prims.size());
    cgltf_free(gltf);
}

void load_avatar(AvatarModel* dest, const char* gltf_path) {
    if (dest->vbo) { glDeleteBuffers(1, &dest->vbo); dest->vbo = 0; }
    for (auto& m : dest->meshes) if (m.tex) glDeleteTextures(1, &m.tex);
    dest->meshes.clear();
    dest->anims.clear();
    dest->loaded = false;

    cgltf_options opts = {};
    cgltf_data* gltf = nullptr;
    cgltf_result r = cgltf_parse_file(&opts, gltf_path, &gltf);
    if (r != cgltf_result_success) { printf("avatar: cgltf_parse_file failed %d\n", r); return; }
    r = cgltf_load_buffers(&opts, gltf, gltf_path);
    if (r != cgltf_result_success) { printf("avatar: cgltf_load_buffers failed %d\n", r); cgltf_free(gltf); return; }

    dest->node_count = (int)gltf->nodes_count;

    for (int ni = 0; ni < dest->node_count; ni++) dest->node_parent[ni] = -1;
    for (int ni = 0; ni < dest->node_count; ni++) {
        cgltf_node* n = &gltf->nodes[ni];
        for (cgltf_size ci = 0; ci < n->children_count; ci++)
            dest->node_parent[(int)(n->children[ci]-gltf->nodes)] = ni;
    }
    for (int ni = 0; ni < dest->node_count; ni++) {
        cgltf_node* n = &gltf->nodes[ni];
        if (n->has_translation) memcpy(dest->node_def_t[ni], n->translation, 12);
        else { dest->node_def_t[ni][0]=0; dest->node_def_t[ni][1]=0; dest->node_def_t[ni][2]=0; }
        if (n->has_rotation) memcpy(dest->node_def_r[ni], n->rotation, 16);
        else { dest->node_def_r[ni][0]=0; dest->node_def_r[ni][1]=0; dest->node_def_r[ni][2]=0; dest->node_def_r[ni][3]=1; }
        if (n->has_scale) memcpy(dest->node_def_s[ni], n->scale, 12);
        else { dest->node_def_s[ni][0]=1; dest->node_def_s[ni][1]=1; dest->node_def_s[ni][2]=1; }
    }

    int node_to_joint[MAX_NODES];
    for (int i = 0; i < MAX_NODES; i++) node_to_joint[i] = -1;
    dest->joint_count = 0;

    int mesh_skin[64];
    memset(mesh_skin, -1, sizeof(mesh_skin));
    for (cgltf_size ni = 0; ni < gltf->nodes_count; ni++) {
        cgltf_node* n = &gltf->nodes[ni];
        if (n->mesh && n->skin) {
            int mi = (int)(n->mesh - gltf->meshes);
            if (mi >= 0 && mi < 64) mesh_skin[mi] = (int)(n->skin - gltf->skins);
        }
    }

    for (cgltf_size si = 0; si < gltf->skins_count; si++) {
        cgltf_skin* sk = &gltf->skins[si];
        for (cgltf_size j = 0; j < sk->joints_count; j++) {
            int ni = (int)(sk->joints[j] - gltf->nodes);
            if (ni < 0 || ni >= MAX_NODES) continue;
            if (node_to_joint[ni] >= 0) continue;
            if (dest->joint_count >= MAX_JOINTS) break;
            node_to_joint[ni] = dest->joint_count;
            dest->joint_nodes[dest->joint_count] = ni;
            if (sk->inverse_bind_matrices)
                cgltf_accessor_read_float(sk->inverse_bind_matrices, j, dest->inv_bind[dest->joint_count], 16);
            else
                m4_identity(dest->inv_bind[dest->joint_count]);
            dest->joint_count++;
        }
    }

    char base_dir[256] = {};
    const char* last_slash = strrchr(gltf_path, '/');
    if (last_slash) {
        int len = (int)(last_slash - gltf_path) + 1;
        if (len < 256) { memcpy(base_dir, gltf_path, len); }
    }

    std::vector<float> vdata;
    for (cgltf_size mi = 0; mi < gltf->meshes_count; mi++) {
        cgltf_primitive* prim = &gltf->meshes[mi].primitives[0];
        cgltf_accessor *pos_acc=nullptr,*uv_acc=nullptr,*norm_acc=nullptr,*joints_acc=nullptr,*weights_acc=nullptr;
        for (cgltf_size ai = 0; ai < prim->attributes_count; ai++) {
            cgltf_attribute& at = prim->attributes[ai];
            if (at.type==cgltf_attribute_type_position)                        pos_acc=at.data;
            if (at.type==cgltf_attribute_type_texcoord && at.index==0)         uv_acc=at.data;
            if (at.type==cgltf_attribute_type_normal)                          norm_acc=at.data;
            if (at.type==cgltf_attribute_type_joints  && at.index==0)         joints_acc=at.data;
            if (at.type==cgltf_attribute_type_weights && at.index==0)         weights_acc=at.data;
        }
        if (!joints_acc || !weights_acc) continue;

        int si_mesh = ((int)mi < 64) ? mesh_skin[(int)mi] : -1;
        cgltf_skin* sk = (si_mesh >= 0 && si_mesh < (int)gltf->skins_count) ? &gltf->skins[si_mesh] : nullptr;

        int icount = (int)prim->indices->count;
        int vstart = (int)(vdata.size() / 16);
        vdata.resize(vdata.size() + icount * 16);
        for (int ii = 0; ii < icount; ii++) {
            unsigned idx = 0; cgltf_accessor_read_uint(prim->indices, ii, &idx, 1);
            float* dst = &vdata[(vstart + ii)*16];
            if (pos_acc)     cgltf_accessor_read_float(pos_acc,    idx, dst+0,  3); else {dst[0]=dst[1]=dst[2]=0;}
            if (uv_acc)      cgltf_accessor_read_float(uv_acc,     idx, dst+3,  2); else {dst[3]=dst[4]=0;}
            if (norm_acc)    cgltf_accessor_read_float(norm_acc,   idx, dst+5,  3); else {dst[5]=0;dst[6]=1;dst[7]=0;}
            { unsigned ji[4]={0,0,0,0}; cgltf_accessor_read_uint(joints_acc, idx, ji, 4);
              if (sk) {
                  for (int k = 0; k < 4; k++) {
                      if (ji[k] < sk->joints_count) {
                          int nidx = (int)(sk->joints[ji[k]] - gltf->nodes);
                          ji[k] = (nidx >= 0 && nidx < MAX_NODES && node_to_joint[nidx] >= 0)
                                  ? (unsigned)node_to_joint[nidx] : 0;
                      } else ji[k] = 0;
                  }
              }
              dst[8]=(float)ji[0];dst[9]=(float)ji[1];dst[10]=(float)ji[2];dst[11]=(float)ji[3]; }
            cgltf_accessor_read_float(weights_acc, idx, dst+12, 4);
        }
        GLuint tex = 0;
        if (prim->material) {
            cgltf_texture* ct = prim->material->pbr_metallic_roughness.base_color_texture.texture;
            if (ct && ct->image) {
                if (ct->image->uri) {
                    char tex_path[512];
                    snprintf(tex_path, sizeof(tex_path), "%s%s", base_dir, ct->image->uri);
                    tex = load_tex(tex_path);
                } else if (ct->image->buffer_view) {
                    tex = load_tex_bv(ct->image->buffer_view);
                }
            }
        }
        AvatarMesh am; am.start = vstart; am.count = icount; am.tex = tex;
        dest->meshes.push_back(am);
    }
    glGenBuffers(1, &dest->vbo);
    glBindBuffer(GL_ARRAY_BUFFER, dest->vbo);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(vdata.size()*4), vdata.data(), GL_STATIC_DRAW);

    dest->idle_anim = 0; dest->walk_anim = 0;
    for (cgltf_size ai = 0; ai < gltf->animations_count; ai++) {
        cgltf_animation* ca = &gltf->animations[ai];
        const char* name = ca->name ? ca->name : "";
        auto icontains = [](const char* h, const char* n) {
            for (; *h; h++) {
                const char *p=h, *q=n;
                for (; *q && tolower((unsigned char)*p)==tolower((unsigned char)*q); p++,q++);
                if (!*q) return true;
            }
            return false;
        };
        if (icontains(name, "idle")) dest->idle_anim = (int)ai;
        if (icontains(name, "walk")) dest->walk_anim = (int)ai;
        CatAnim anim; anim.duration = 0.f;
        float anim_min_t = 1e30f;
        for (cgltf_size si = 0; si < ca->samplers_count; si++) {
            float first = 0.f, last = 0.f;
            cgltf_accessor_read_float(ca->samplers[si].input, 0, &first, 1);
            cgltf_accessor_read_float(ca->samplers[si].input, ca->samplers[si].input->count-1, &last, 1);
            if (first < anim_min_t) anim_min_t = first;
            if (last > anim.duration) anim.duration = last;
        }
        if (anim_min_t < 0.f) anim_min_t = 0.f;
        anim.duration -= anim_min_t;
        for (cgltf_size ci = 0; ci < ca->channels_count; ci++) {
            cgltf_animation_channel* ch = &ca->channels[ci];
            int path = -1;
            if (ch->target_path == cgltf_animation_path_type_translation) path=0;
            else if (ch->target_path == cgltf_animation_path_type_rotation)    path=1;
            else if (ch->target_path == cgltf_animation_path_type_scale)       path=2;
            if (path < 0) continue;
            CatChannel chan;
            chan.node = (int)(ch->target_node - gltf->nodes);
            chan.path = path;
            cgltf_accessor* inp = ch->sampler->input;
            chan.times.resize(inp->count);
            for (cgltf_size k=0;k<inp->count;k++) {
                cgltf_accessor_read_float(inp,k,&chan.times[k],1);
                chan.times[k] -= anim_min_t;
            }
            cgltf_accessor* out = ch->sampler->output;
            int comp = (path==1)?4:3;
            chan.values.resize(out->count*comp);
            for (cgltf_size k=0;k<out->count;k++) cgltf_accessor_read_float(out,k,&chan.values[k*comp],comp);
            anim.channels.push_back(std::move(chan));
        }
        dest->anims.push_back(std::move(anim));
    }
    printf("avatar: %d joints, %zu meshes, %zu anims, idle=%d walk=%d\n",
           dest->joint_count, dest->meshes.size(), dest->anims.size(), dest->idle_anim, dest->walk_anim);

    if (!g_skin_prog) {
        GLuint vs=make_shader(GL_VERTEX_SHADER,SKIN_VS);
        GLuint fs=make_shader(GL_FRAGMENT_SHADER,SKIN_FS);
        g_skin_prog=glCreateProgram();
        glAttachShader(g_skin_prog,vs); glAttachShader(g_skin_prog,fs);
        glLinkProgram(g_skin_prog);
        { GLint ok; glGetProgramiv(g_skin_prog,GL_LINK_STATUS,&ok);
          if(!ok){char buf[512];glGetProgramInfoLog(g_skin_prog,512,nullptr,buf);printf("skin link error: %s\n",buf);} }
        glDeleteShader(vs); glDeleteShader(fs);
        g_skin_u_vp    =glGetUniformLocation(g_skin_prog,"u_vp");
        g_skin_u_world =glGetUniformLocation(g_skin_prog,"u_world");
        g_skin_u_bones =glGetUniformLocation(g_skin_prog,"u_bones");
        g_skin_u_tex        =glGetUniformLocation(g_skin_prog,"u_tex");
        g_skin_u_tv_quad_pos=glGetUniformLocation(g_skin_prog,"u_tv_quad_pos");
        g_skin_u_tv_quad_col=glGetUniformLocation(g_skin_prog,"u_tv_quad_col");
        g_skin_u_tv_normal  =glGetUniformLocation(g_skin_prog,"u_tv_normal");
        g_skin_u_cone_power =glGetUniformLocation(g_skin_prog,"u_cone_power");
        g_skin_u_lamp_pos=glGetUniformLocation(g_skin_prog,"u_lamp_pos");
        g_skin_u_lamp_intensity=glGetUniformLocation(g_skin_prog,"u_lamp_intensity");
        g_skin_u_flat_shade=glGetUniformLocation(g_skin_prog,"u_flat_shade");
        g_skin_a_pos    =glGetAttribLocation(g_skin_prog,"a_pos");
        g_skin_a_uv     =glGetAttribLocation(g_skin_prog,"a_uv");
        g_skin_a_norm   =glGetAttribLocation(g_skin_prog,"a_norm");
        g_skin_a_joints =glGetAttribLocation(g_skin_prog,"a_joints");
        g_skin_a_weights=glGetAttribLocation(g_skin_prog,"a_weights");
    }

    cgltf_free(gltf);
    dest->loaded = true;
}

void load_cat()        { load_avatar(&g_models[0], "/tv/cat/scene.gltf"); }
void load_incidental() { load_avatar(&g_models[1], "/tv/incidental_70/scene.gltf"); }
void load_mech()       { load_avatar(&g_models[2], "/tv/Mech.glb"); }
void load_knight()     { load_avatar(&g_models[3], "/tv/knight/scene.gltf"); }
