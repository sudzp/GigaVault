package com.gigavault.backend.repository;

import com.gigavault.backend.model.UploadPart;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface UploadPartRepository extends JpaRepository<UploadPart, UploadPart.UploadPartId> {

    List<UploadPart> findBySessionIdOrderByPartNumberAsc(String sessionId);
}
