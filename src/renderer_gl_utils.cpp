// renderer_gl_utils.cpp
// Shader compilation and texture loading helpers.

#define STB_IMAGE_IMPLEMENTATION
#include "renderer_types.h"

GLuint make_shader(GLenum type, const char* src) {
    GLuint s=glCreateShader(type);
    glShaderSource(s,1,&src,nullptr); glCompileShader(s);
    GLint ok; glGetShaderiv(s,GL_COMPILE_STATUS,&ok);
    if (!ok) { char buf[512]; glGetShaderInfoLog(s,512,nullptr,buf); printf("Shader error: %s\n",buf); }
    return s;
}

GLuint load_tex(const char* path) {
    int w,h,ch;
    uint8_t* px=stbi_load(path,&w,&h,&ch,4);
    if (!px) { printf("Cannot load texture: %s\n",path); return 0; }
    GLuint t; glGenTextures(1,&t);
    glBindTexture(GL_TEXTURE_2D,t);
    glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,w,h,0,GL_RGBA,GL_UNSIGNED_BYTE,px);
    glGenerateMipmap(GL_TEXTURE_2D);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR_MIPMAP_LINEAR);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_REPEAT);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_REPEAT);
    stbi_image_free(px);
    return t;
}

GLuint load_tex_bv(cgltf_buffer_view* bv) {
    if (!bv || !bv->buffer->data) return 0;
    const uint8_t* d = (const uint8_t*)bv->buffer->data + bv->offset;
    int w,h,ch;
    uint8_t* px = stbi_load_from_memory(d,(int)bv->size,&w,&h,&ch,4);
    if (!px) {
        printf("load_tex_bv: stbi failed (size=%zu, reason=%s)\n", bv->size, stbi_failure_reason());
        return 0;
    }
    GLuint t; glGenTextures(1,&t);
    glBindTexture(GL_TEXTURE_2D,t);
    glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,w,h,0,GL_RGBA,GL_UNSIGNED_BYTE,px);
    glGenerateMipmap(GL_TEXTURE_2D);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR_MIPMAP_LINEAR);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_REPEAT);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_REPEAT);
    stbi_image_free(px);
    return t;
}
