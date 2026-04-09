// renderer_types.h
// Shared types, constants, extern global declarations, and function prototypes
// for all renderer translation units.

#pragma once

#include <GLES2/gl2.h>
#include <cgltf.h>
#include <stb_image.h>
#include <cstring>
#include <cstdio>
#include <cmath>
#include <vector>
#include <algorithm>

// ============================================================
//  Matrix type
// ============================================================
typedef float M4[16];

// ============================================================
//  Tuning constants
// ============================================================

// Player movement
constexpr float PLAYER_SPEED       = 0.8f;
constexpr float MOUSE_SENSITIVITY  = 0.0025f;
constexpr float PLAYER_START_X     = 0.f;
constexpr float PLAYER_START_Y     = 20.f;
constexpr float PLAYER_START_Z     = -80.f;
constexpr float CAT_EYE_HEIGHT_DEFAULT = -35.f;

// Avatar / skinned mesh
constexpr float AVATAR_SCALE       = 0.2f;
constexpr int   MAX_JOINTS         = 48;
constexpr int   MAX_NODES          = 64;
constexpr int   MAX_AVATAR_MODELS  = 4;

// Lighting
constexpr float TV_LIGHT_PUSH      = 15.f;
constexpr float CONE_POWER_DEFAULT = 18.2f;
constexpr float CONE_PITCH_DEFAULT = -362.f;

// CRT post-process
constexpr int   CRT_W              = 640;
constexpr int   CRT_H              = 480;

// Multiplayer
constexpr int   MAX_REMOTE         = 8;
constexpr int   NAMEPLATE_BUF_SIZE = 256 * 64 * 4;

// ============================================================
//  Struct definitions
// ============================================================

struct TvPrim {
    GLuint vbo;
    int    vcount;
    GLuint base_tex;
    bool   is_screen;
    bool   double_sided;
    bool   is_room;
    M4     world;
};

struct LightState {
    float lamp_pos[3]      = {0.f, -45.f, -260.f};
    float lamp_intensity   = 1.0f;
    float tv_intensity     = 1.7f;
    float quad_col[4][3]   = {{0.3f,0.4f,0.8f},{0.3f,0.4f,0.8f},{0.3f,0.4f,0.8f},{0.3f,0.4f,0.8f}};
    float quad_pos[4][3]   = {};
    float cone_yaw         = 0.f;
    float cone_pitch       = CONE_PITCH_DEFAULT;
    float cone_power       = CONE_POWER_DEFAULT;
    float screen_normal[3] = {0.f, 0.f, -1.f};
    float screen_pos[3]    = {};
    float half_x           = 0.5f;
    float half_y           = 0.5f;
};

struct SceneState {
    float room_scale  = 32.f;
    float room_rot_y  = -3.14159265f;
    float room_tx     = 4.f;
    float room_ty     = 21.f;
    float room_tz     = 15.f;
    float overscan_x  = 0.04f;
    float overscan_y  = 0.04f;
    int   canvas_w    = 1;
    int   canvas_h    = 1;
    int   frame_count = 0;
};

struct Player {
    float x = PLAYER_START_X, y = PLAYER_START_Y, z = PLAYER_START_Z;
    float yaw = 0.f, pitch = 0.f;
};

struct RemotePlayer {
    float x = 0.f, y = -40.f, z = 0.f;
    float yaw = 0.f;
    bool  active = false;
    bool  moving = false;
    float anim_time = 0.f;
    int   anim_idx  = 0;
    int   model_idx = 0;
    GLuint name_tex = 0;
    int    name_w = 0, name_h = 0;
};

struct PreviewXform { float x, y, z, scale; };

struct CatChannel {
    int node, path; // path: 0=T, 1=R, 2=S
    std::vector<float> times, values;
};

struct CatAnim {
    float duration;
    std::vector<CatChannel> channels;
};

struct AvatarMesh { int start, count; GLuint tex; };

struct AvatarModel {
    GLuint vbo = 0;
    std::vector<AvatarMesh> meshes;
    int joint_count = 0;
    int joint_nodes[MAX_JOINTS] = {};
    float inv_bind[MAX_JOINTS][16] = {};
    int node_count = 0;
    int node_parent[MAX_NODES] = {};
    float node_def_t[MAX_NODES][3] = {};
    float node_def_r[MAX_NODES][4] = {};
    float node_def_s[MAX_NODES][3] = {};
    std::vector<CatAnim> anims;
    int idle_anim = 0;
    int walk_anim = 0;
    bool loaded = false;
};

struct AnimState {
    float bone_mats [MAX_JOINTS][16];
    float node_t    [MAX_NODES][3];
    float node_r    [MAX_NODES][4];
    float node_s    [MAX_NODES][3];
    float node_global[MAX_NODES][16];
};

// ============================================================
//  Extern global declarations (defined in renderer.cpp)
// ============================================================
extern std::vector<TvPrim> g_prims;
extern GLuint g_game_tex;
extern GLuint g_white_tex;
extern LightState g_light;
extern SceneState g_scene;
extern GLuint g_prog;
extern int    g_a_pos, g_a_uv, g_a_norm;
extern int    g_u_mvp, g_u_model, g_u_tex, g_u_screen, g_u_overscan;
extern int    g_u_tv_quad_pos, g_u_tv_quad_col, g_u_tv_normal;
extern int    g_u_lamp_pos, g_u_lamp_intensity;
extern int    g_u_cone_power, g_skin_u_cone_power;
extern float  g_cat_eye_height;
extern Player g_local;
extern RemotePlayer g_remote[MAX_REMOTE];
extern bool  g_preview_active;
extern int   g_preview_model;
extern float g_preview_anim_t;
extern float g_preview_spin;
extern PreviewXform g_preview_xform[4];
extern AvatarModel g_models[MAX_AVATAR_MODELS];
extern GLuint g_skin_prog;
extern AnimState g_anim;
extern int    g_skin_u_vp, g_skin_u_world, g_skin_u_bones;
extern int    g_skin_u_tex, g_skin_u_tv_quad_pos, g_skin_u_tv_quad_col, g_skin_u_tv_normal;
extern int    g_skin_u_lamp_pos, g_skin_u_lamp_intensity, g_skin_u_flat_shade;
extern int    g_skin_a_pos, g_skin_a_uv, g_skin_a_norm;
extern int    g_skin_a_joints, g_skin_a_weights;
extern bool g_move[4];
extern GLuint g_flat_prog;
extern int    g_flat_a_pos, g_flat_u_mvp, g_flat_u_color;
extern GLuint g_cube_vbo;
extern float  g_debug_pos[3];
extern bool   g_debug_visible;
extern GLuint g_bill_prog;
extern int    g_bill_a_corner;
extern int    g_bill_u_center, g_bill_u_cam_right, g_bill_u_cam_up;
extern int    g_bill_u_hw, g_bill_u_hh, g_bill_u_vp;
extern GLuint g_bill_vbo;
extern uint8_t g_name_upload_buf[NAMEPLATE_BUF_SIZE];
extern unsigned g_frame_w, g_frame_h;
extern GLuint g_crt_fbo, g_crt_tex, g_crt_prog, g_crt_vbo;
extern int    g_crt_a_vert, g_crt_a_uv;
extern int    g_crt_u_mvp, g_crt_u_fcount;
extern int    g_crt_u_out, g_crt_u_texsz, g_crt_u_insz, g_crt_u_tex;

// ============================================================
//  Function declarations
// ============================================================

// Math (renderer_math.cpp)
void m4_identity(M4 m);
void m4_mul(M4 out, const M4 a, const M4 b);
void m4_persp(M4 m, float fov, float asp, float n, float f);
void m4_lookat(M4 m, float ex, float ey, float ez, float tx, float ty, float tz);
void m4_from_trs(M4 out, const float t[3], const float r[4], const float s[3]);
void q_slerp(float* out, const float* a, const float* b, float t);

// GL utilities (renderer_gl_utils.cpp)
GLuint make_shader(GLenum type, const char* src);
GLuint load_tex(const char* path);
GLuint load_tex_bv(cgltf_buffer_view* bv);

// Scene loading (renderer_scene.cpp)
void load_tv();
void load_room();
void load_avatar(AvatarModel* dest, const char* gltf_path);
void load_cat();
void load_incidental();
void load_mech();
void load_knight();

// CRT post-process (renderer_crt.cpp)
void init_crt();
void render_crt_pass();

// Animation (renderer_anim.cpp)
void update_anim(AvatarModel* mdl, int anim_idx, float anim_time);

// Render passes (renderer_render.cpp)
void update_player();
void render_scene(const M4 vp, const float scaled_col[4][3], const float cone_dir[3]);
void render_avatars(const M4 vp, const M4 view, const float scaled_col[4][3], const float cone_dir[3]);
void render_preview();
void render();
