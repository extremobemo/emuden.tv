// renderer_crt.cpp
// CRT post-process: renders game texture through a scanline/warp shader into an FBO,
// then the FBO texture is composited onto the TV screen geometry in the main pass.

#include "renderer_types.h"
#include "renderer_shaders.h"

void init_crt() {
    GLuint vs = make_shader(GL_VERTEX_SHADER,   CRT_VS);
    GLuint fs = make_shader(GL_FRAGMENT_SHADER, CRT_FS);
    g_crt_prog = glCreateProgram();
    glAttachShader(g_crt_prog, vs); glAttachShader(g_crt_prog, fs);
    glLinkProgram(g_crt_prog);
    glDeleteShader(vs); glDeleteShader(fs);

    g_crt_a_vert  = glGetAttribLocation (g_crt_prog, "VertexCoord");
    g_crt_a_uv    = glGetAttribLocation (g_crt_prog, "TexCoord");
    g_crt_u_mvp   = glGetUniformLocation(g_crt_prog, "MVPMatrix");
    g_crt_u_fcount= glGetUniformLocation(g_crt_prog, "FrameCount");
    g_crt_u_out   = glGetUniformLocation(g_crt_prog, "OutputSize");
    g_crt_u_texsz = glGetUniformLocation(g_crt_prog, "TextureSize");
    g_crt_u_insz  = glGetUniformLocation(g_crt_prog, "InputSize");
    g_crt_u_tex   = glGetUniformLocation(g_crt_prog, "Texture");

    static const float quad[] = {
        -1,-1,0,1,  0,0,0,0,
         1,-1,0,1,  1,0,0,0,
        -1, 1,0,1,  0,1,0,0,
         1,-1,0,1,  1,0,0,0,
         1, 1,0,1,  1,1,0,0,
        -1, 1,0,1,  0,1,0,0,
    };
    glGenBuffers(1, &g_crt_vbo);
    glBindBuffer(GL_ARRAY_BUFFER, g_crt_vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(quad), quad, GL_STATIC_DRAW);

    glGenTextures(1, &g_crt_tex);
    glBindTexture(GL_TEXTURE_2D, g_crt_tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, CRT_W, CRT_H, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

    glGenFramebuffers(1, &g_crt_fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, g_crt_fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, g_crt_tex, 0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE)
        printf("CRT FBO incomplete\n");
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

void render_crt_pass() {
    glBindFramebuffer(GL_FRAMEBUFFER, g_crt_fbo);
    glViewport(0, 0, CRT_W, CRT_H);
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_CULL_FACE);
    glClear(GL_COLOR_BUFFER_BIT);

    M4 identity; m4_identity(identity);
    glUseProgram(g_crt_prog);
    glUniformMatrix4fv(g_crt_u_mvp,    1, GL_FALSE, identity);
    glUniform1i(g_crt_u_fcount, g_scene.frame_count++);
    glUniform2f(g_crt_u_out,   (float)CRT_W, (float)CRT_H);
    glUniform2f(g_crt_u_texsz, (float)g_frame_w, (float)g_frame_h);
    glUniform2f(g_crt_u_insz,  (float)g_frame_w, (float)g_frame_h);
    glUniform1i(g_crt_u_tex, 0);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, g_game_tex);

    glBindBuffer(GL_ARRAY_BUFFER, g_crt_vbo);
    int stride = 8 * sizeof(float);
    glEnableVertexAttribArray(g_crt_a_vert);
    glVertexAttribPointer(g_crt_a_vert, 4, GL_FLOAT, GL_FALSE, stride, (void*)0);
    glEnableVertexAttribArray(g_crt_a_uv);
    glVertexAttribPointer(g_crt_a_uv,   4, GL_FLOAT, GL_FALSE, stride, (void*)(4*sizeof(float)));

    glDrawArrays(GL_TRIANGLES, 0, 6);

    glDisableVertexAttribArray(g_crt_a_vert);
    glDisableVertexAttribArray(g_crt_a_uv);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glEnable(GL_DEPTH_TEST);
    glEnable(GL_CULL_FACE);
}
